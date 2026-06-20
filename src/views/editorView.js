/*
    Copyright 2026 Julien Javelaud

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/


// === Note Editor page ===

// --- IMPORTS --------------------------------------------------------------------------------

// Services
import { authService } from "../services/authService"
import { noteService } from "../services/noteService"
import { tagService } from "../services/tagService"
import { userService } from "../services/userService"

// HTML Templates
import htmlTemplate from "../templates/editorTemplate.html?raw"

// CodeMirror Imports (Library)
import { EditorView as CodeMirror } from "codemirror"
import { basicSetup } from "codemirror"
import { markdown } from "@codemirror/lang-markdown"
import { oneDark } from "@codemirror/theme-one-dark"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags as t } from "@lezer/highlight"
import { EditorSelection } from "@codemirror/state"
import { keymap } from "@codemirror/view"
import { undo, redo } from "@codemirror/commands"
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { selectAll, moveLineUp, moveLineDown } from "@codemirror/commands"

// Marked Imports (Library)
import { marked } from 'marked'

// html2pdf Imports (Library)
import html2pdf from 'html2pdf.js'

// VisNetwork Imports (Library)
import { Network, DataSet } from "vis-network/standalone"


// --- PRIVATE MODULE-LEVEL STATE ---------------------------------------------------------------------

let currentNoteId = null // To track the note ID
let saveTimer = null // Timer for auto-save
let editorInstance = null // CodeMirror editor instance
let cachedNotes = [] // Keeps a high-speed frontend cache of all user notes
let cachedTags = [] // Array of all tags created by the user
let activeFilters = [] // Array of tag IDs currently used to filter the note list
let isPreviewMode = false // Tracks current layout state for the markdown vs split views
let imageRenderCount = 0 // Tracks image order sequence during a single render pass


// --- PRIVATE MODULE SCOPE HELPER FUNCTIONS -----------------------------------------------------------

function attachImageResizeHandlers(previewContainer, editorInstance) {
    if (!previewContainer || !editorInstance) return

    previewContainer.querySelectorAll('.resizable-image-wrapper').forEach(wrapper => {
        const img = wrapper.querySelector('img')
        const handle = wrapper.querySelector('.resize-handle')
        if (!img || !handle) return

        const targetOccurrenceIndex = parseInt(wrapper.getAttribute('data-image-index'), 10)

        handle.addEventListener('pointerdown', (e) => {
            // Prevent text highlight selections and browser default drag side-effects
            e.preventDefault() 

            handle.releasePointerCapture(e.pointerId)
            
            // Sample accurate layout dimensions including fractional sub-pixels
            const rect = img.getBoundingClientRect()
            const startWidth = rect.width
            const startX = e.clientX
            
            // Add visual helper class to parent container for styling during an active drag (optional)
            wrapper.classList.add('is-resizing')

            const onPointerMove = (moveEvent) => {
                // Calculate scale variance against origin coordinate point
                const currentWidth = startWidth + (moveEvent.clientX - startX)
                
                // Read parent containment bounds to prevent blowing past the layout edge
                const maxAvailableWidth = wrapper.parentElement.clientWidth

                if (currentWidth > 50 && currentWidth <= maxAvailableWidth) {
                    // Force direct inline modifications onto the element nodes
                    img.style.setProperty('width', `${Math.round(currentWidth)}px`, 'important')
                    img.style.setProperty('height', 'auto', 'important')
                }
            }

            const onPointerUp = (upEvent) => {
                // Clean up listeners from the global window pool cleanly
                window.removeEventListener('pointermove', onPointerMove)
                window.removeEventListener('pointerup', onPointerUp)
                
                wrapper.classList.remove('is-resizing')

                const finalWidth = Math.round(img.getBoundingClientRect().width)
                const rawSrc = img.getAttribute('data-raw-src')
                const currentDoc = editorInstance.state.doc.toString()
                
                const targetRegex = new RegExp(`!\\[([^\\]]*)\\]\\(${RegExp.escape(rawSrc)}(?:\\s+=[^\\)]*)?\\)`, 'g')

                let match
                let matchCounter = 0
                let finalTargetMatch = null

                while ((match = targetRegex.exec(currentDoc)) !== null) {
                    if (matchCounter === targetOccurrenceIndex) {
                        finalTargetMatch = match
                        break
                    }
                    matchCounter++
                }

                if (finalTargetMatch) {
                    const fullMatchString = finalTargetMatch[0]
                    const altText = finalTargetMatch[1]
                    const replacement = `![${altText}](${rawSrc} =${finalWidth})`

                    editorInstance.dispatch({
                        changes: {
                            from: finalTargetMatch.index,
                            to: finalTargetMatch.index + fullMatchString.length,
                            insert: replacement
                        }
                    })
                }
            }

            // Attach listeners globally so tracking never cuts out mid-flight
            window.addEventListener('pointermove', onPointerMove, { passive: false })
            window.addEventListener('pointerup', onPointerUp)
        })
    })
}

// Escapes special characters inside user-provided string URLs for safe Regex matching
RegExp.escape = function(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}


// --- CODEMIRROR CANVAS OVERRIDES & CUSTOM EXTENSIONS --------------------------------------------------

// 1. Canvas Overrides (Font family, line-heights, workspace padding)
const voltairaCanvasTheme = CodeMirror.theme({
    "&": {
        backgroundColor: "#121214",
        fontSize: "16px"
    },
    ".cm-content": {
        fontFamily: "'Quicksand', sans-serif",
        lineHeight: "1.6",
        padding: "2rem"
    },
    ".cm-line": {
        padding: "0 0.5rem"
    },
    ".cm-activeLine": {
        backgroundColor: "#1a1a1e" // Subtle row highlight
    }
}, { dark: true })

// 2. Markdown Token Styling (Headers, code blocks, bold text)
const voltairaMarkdownHighlight = HighlightStyle.define([
    { tag: t.heading1, fontSize: "2rem", fontWeight: "700", color: "#00ffcc", block: true },
    { tag: t.heading2, fontSize: "1.6rem", fontWeight: "600", color: "#e1e1e6", block: true },
    { tag: t.heading3, fontSize: "1.2rem", fontWeight: "600", color: "#e1e1e6", block: true },
    { tag: t.strong, fontWeight: "bold", color: "#ffffff" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.link, color: "#00ffcc", textDecoration: "underline" }
])

// Intercepts the Tab key inside Markdown tables to smoothly jump cell-by-cell.
const tableTabNavigationExtension = keymap.of([{
    key: "Tab",
    run: (view) => {
        const { state } = view;
        const { head } = state.selection.main
        const line = state.doc.lineAt(head)
        
        // Heuristic Check: If the line doesn't start with a structural pipe symbol, skip it!
        if (!line.text.trim().startsWith('|')) return false;

        // 1. Map out all native pipe characters across the active text line
        const pipePositions = []
        for (let i = 0; i < line.text.length; i++) {
            // Ignore escaped pipeline markers matching '\|' combinations safely
            if (line.text[i] === '|' && (i === 0 || line.text[i - 1] !== '\\')) {
                pipePositions.push(line.from + i)
            }
        }

        // 2. Identify precisely which column cell coordinates the user's cursor currently occupies
        let currentCellIdx = -1
        for (let i = 0; i < pipePositions.length - 1; i++) {
            if (head >= pipePositions[i] && head <= pipePositions[i + 1]) {
                currentCellIdx = i
                break
            }
        }

        let targetFrom = null
        let targetTo = null

        // 3. Coordinate Traversal Execution Calculations
        if (currentCellIdx !== -1 && currentCellIdx < pipePositions.length - 2) {
            // Option A: Advance cursor smoothly to the adjacent cell on the SAME line row
            targetFrom = pipePositions[currentCellIdx + 1] + 1
            targetTo = pipePositions[currentCellIdx + 2]
        } else {
            // Option B: We reached the final cell column boundary! Wrap down to the NEXT row line
            if (line.number >= state.doc.lines) return false // Fail-safe abort if boundary end
            
            const nextLine = state.doc.line(line.number + 1)
            if (!nextLine.text.trim().startsWith('|')) return false // Next line isn't part of the table

            const nextLinePipes = []
            for (let i = 0; i < nextLine.text.length; i++) {
                if (nextLine.text[i] === '|' && (i === 0 || nextLine.text[i - 1] !== '\\')) {
                    nextLinePipes.push(nextLine.from + i)
                }
            }
            if (nextLinePipes.length < 2) return false

            targetFrom = nextLinePipes[0] + 1
            targetTo = nextLinePipes[1]
        }

        if (targetFrom === null || targetTo === null) return false

        // 4. UX Polishing Step: Read the target cell text string and trim padding selection spacing boundaries
        const rawCellContent = state.doc.sliceString(targetFrom, targetTo)
        const leadingSpacesCount = rawCellContent.length - rawCellContent.trimStart().length
        const trailingSpacesCount = rawCellContent.length - rawCellContent.trimEnd().length

        const finalSelectionFrom = targetFrom + leadingSpacesCount
        const finalSelectionTo = Math.max(finalSelectionFrom, targetTo - trailingSpacesCount)

        // 5. Fire transaction update and instantly focus highlight the cell inner value block
        view.dispatch({
            selection: EditorSelection.range(finalSelectionFrom, finalSelectionTo),
            scrollIntoView: true
        })

        return true // SUCCESS: Halts standard browser default focus changes instantly
    }
}])

// Text highlighting extension
const setHighlightEffect = StateEffect.define()

const occurrenceHighlightField = StateField.define({
    create() { return Decoration.none; },
    update(decorations, tr) {
        // Map decoration coordinates forward seamlessly if text is edited
        decorations = decorations.map(tr.changes)

        // Process incoming query highlights
        for (let effect of tr.effects) {
            if (effect.is(setHighlightEffect)) {
                const { query, docText } = effect.value
                
                // If query is empty, wipe out all decorations cleanly
                if (!query) return Decoration.none

                const deco = []
                let pos = 0
                const lowerText = docText.toLowerCase()
                const lowerQuery = query.toLowerCase()

                // Scan document linearly for matches
                while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
                    deco.push(
                        Decoration.mark({ class: "cm-occurrence-highlight" }).range(pos, pos + query.length)
                    )
                    pos += query.length // Move past match
                }
                return Decoration.set(deco)
            }
        }
        return decorations
    },
    // Supply both the decorations array AND a direct DOM event listener
    provide: f => [
        CodeMirror.decorations.from(f),
        CodeMirror.domEventHandlers({
            mousedown(event, view) {
                // If there are active highlights on screen, clear them instantly on click
                if (view.state.field(occurrenceHighlightField).size > 0) {
                    view.dispatch({
                        effects: setHighlightEffect.of({ query: "", docText: "" })
                    })
                }
            }
        })
    ]
})

// CodeMirror 6 Extension to catch modifier clicks on internal workspace links
const noteNavigationClickExtension = (onInternalLinkTriggered) => {
    return CodeMirror.domEventHandlers({
        click(event, view) {
            // Require Ctrl (Windows/Linux) or Cmd (Mac) so standard editing clicks still work!
            if (!event.ctrlKey && !event.metaKey) return false

            // 1. Calculate the exact character coordinate position where the mouse hit
            const clickPosition = view.posAtCoords({ x: event.clientX, y: event.clientY })
            if (clickPosition === null) return false

            // 2. Fetch the text line boundaries surrounding that click position
            const line = view.state.doc.lineAt(clickPosition)
            const lineText = line.text
            const relativeClickOffset = clickPosition - line.from

            // 3. Scan the line text for standard Markdown link formatting: [Label](target-id)
            const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
            let match

            while ((match = markdownLinkRegex.exec(lineText)) !== null) {
                const startIdx = match.index
                const endIdx = markdownLinkRegex.lastIndex

                // 4. Verify if the click occurred inside this specific link match
                if (relativeClickOffset >= startIdx && relativeClickOffset <= endIdx) {
                    const linkTarget = match[2] // This is what sits inside the (...) parentheses

                    // Verify if it's an internal target ID instead of an external web link
                    if (!linkTarget.startsWith('http://') && !linkTarget.startsWith('https://')) {
                        event.preventDefault() // Stop standard text cursor re-focus
                        
                        // Fire the application-level navigation callback smoothly!
                        onInternalLinkTriggered(linkTarget) 
                        return true // Mark the transaction handled in CodeMirror
                    }
                }
            }
            return false // Let CodeMirror handle normal editing mechanics if click wasn't on a link
        }
    })
}


// --- MARKED.JS CUSTOM EXTENSIONS --------------------------------------------------

// Custom image token hook
const universalImageExtension = {
    name: 'universalImage',
    level: 'inline',
    // Tells Marked to trigger this tokenizer whenever it encounters an exclamation mark
    start(src) { 
        return src.indexOf('!') 
    },
    tokenizer(src, tokens) {
        // Intercept anything matching the baseline Markdown image syntax structure
        const match = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(src)
        
        if (match) {
            return {
                type: 'universalImage', // Unique custom token token identifier
                raw: match[0],          // The complete unparsed string chunk
                alt: match[1],          // The extracted Alt Text string
                href: match[2].trim()   // The extracted raw link payload with sizing info
            }
        }
    },
    renderer(token) {
        const rawHref = token.href
        const altText = token.alt

        // Our sizing format checker rule (=WIDTHxHEIGHT, =WIDTH, or =PERCENT%)
        const sizeRegex = /=(?:(\d+)x(\d+)|(\d+%|\d+))$/
        const match = rawHref.match(sizeRegex)

        let cleanHref = rawHref
        let dimensionsStyle = ''

        if (match) {
            // Strip the custom size notation completely so the browser gets a clean asset source link
            cleanHref = rawHref.replace(sizeRegex, '').trim()

            if (match[1] && match[2]) {
                // Formatted as: =300x200
                dimensionsStyle = `width="${match[1]}" height="${match[2]}"`
            } else if (match[3]) {
                const sizeValue = match[3]
                if (sizeValue.endsWith('%')) {
                    // Formatted as: =50%
                    dimensionsStyle = `style="width: ${sizeValue}; height: auto;"`
                } else {
                    // Formatted as: =300
                    dimensionsStyle = `width="${sizeValue}" height="auto"`
                }
            }
        }

        // Grab our running occurrence tracker index
        const currentIndex = imageRenderCount
        imageRenderCount++

        // Return the full resizable HTML block wrapper
        return `
            <span class="resizable-image-wrapper" data-image-index="${currentIndex}">
                <img src="${cleanHref}" data-raw-src="${cleanHref}" alt="${altText || ''}" ${dimensionsStyle} class="rendered-note-img" />
                <span class="resize-handle"></span>
            </span>
        `.trim()
    }
}

// Register the extensions
marked.use({ 
    breaks: true, // Converts single '\n' line breaks into HTML <br> tags
    extensions: [universalImageExtension] 
})


// --- EXPORT -----------------------------------------------------------------------

export const EditorView = {
    render: () => {
        return htmlTemplate
    },

    // Method to let our router tell the view which note to load
    loadNote: async (noteId) => {
        // 1. SAFETY SHIELD: Immediately kill any pending autosave countdown clocks
        // from the previous note so it doesn't execute on our new note canvas
        if (saveTimer) {
            clearTimeout(saveTimer)
            console.log("Pending autosave sequence safely neutralized.")
        }

        try {
            // 2. Fetch fresh data from our data layer repository
            const note = await noteService.getNoteById(noteId)

            // 3. Update the tracking pointer to this new document
            currentNoteId = note._id
            
            // 4. Populate the fields with raw strings directly from MongoDB
            const titleInput = document.getElementById('note-title')
            const titlePreview = document.getElementById('preview-note-title')
            if (titleInput) titleInput.value = note.title || ''
            if (titlePreview) titlePreview.innerText = note.title || ''

            if (editorInstance) {
                editorInstance.dispatch({
                    changes: {
                        from: 0,
                        to: editorInstance.state.doc.length,
                        insert: note.content || ''
                    }
                })
            }

            // 5. State Toggle: Un-hide the workspace and hide the splash/welcome layout
            const workspaceShell = document.getElementById('editor-workspace-shell')
            const welcomeShell = document.getElementById('welcome-splash-shell')

            if (workspaceShell && welcomeShell) {
                workspaceShell.removeAttribute('data-is-hidden')
                welcomeShell.setAttribute('data-is-hidden', 'true')
            }

            // 6. Update active state in sidebar UI
            EditorView.highlightActiveSidebarItem(noteId)

            // 7. Populate the tabs contents
            EditorView.syncTableOfContents(editorInstance.state.doc)
            EditorView.syncOutgoingLinks(editorInstance.state.doc, cachedNotes)
            EditorView.renderExplorer()
            EditorView.renderTagInspector()

            // 8. Gives the focus to the editor
            editorInstance.focus()

            console.log(`Successfully populated workspace canvas for note: "${note.title}"`)
        } catch (error) {
            console.error(`Failed to execute view state population for note ID (${noteId}):`, error)
            await EditorView.alertModal(`Could not load note with ID: ${noteId}`, 'error')
        }
    },

    // Triggers a non-blocking informational or error alert modal window
    // Resolves when the user clicks the "Ok" button
    alertModal: function(message, type = 'info') {
        return new Promise((resolve) => {
            // 1. Grab our DOM hooks
            const overlay = document.getElementById('editor-modal-overlay-info')
            const titleEl = document.getElementById('editor-modal-title-info')
            const messageEl = document.getElementById('editor-modal-info-message')
            const textEl = document.getElementById('modal-info-text')
            const iconContainer = document.getElementById('modal-info-icon')
            const okBtn = document.getElementById('editor-modal-ok-btn')

            if (!overlay || !titleEl || !textEl || !iconContainer || !okBtn) {
                console.error("Missing modal HTML baseline configurations inside the index.")
                return resolve()
            }

            // 2. Define our SVG graphics dictionary dynamically
            const icons = {
                error: `<svg><use href="#icon-error"/></svg>`,
                success: `<svg><use href="#icon-success"/></svg>`,
                info: `<svg><use href="#icon-info"/></svg>`
            }

            // 3. Define the auto-titles matching the nature of the event
            const titles = {
                error: "Oops, Something went wrong...",
                success: "Bravo!",
                info: "Information"
            }

            // 4. Populate content values into the template target frames
            titleEl.textContent = titles[type] || titles.info
            textEl.textContent = message
            iconContainer.innerHTML = icons[type] || icons.info

            // Remove previous theme classes and apply the current active styling context
            messageEl.classList.remove('theme-error', 'theme-success', 'theme-info')
            messageEl.classList.add(`theme-${type}`)

            // 5. Build clean, disposable closing event hooks
            const cleanUpAndClose = () => {
                overlay.classList.add('is-hidden')
                okBtn.removeEventListener('click', handleOkClick)
                document.removeEventListener('keydown', handleKeyDown)
                resolve() // Resolve promise context so code execution flows outward
            }

            const handleOkClick = (e) => {
                e.preventDefault()
                cleanUpAndClose()
            }

            const handleKeyDown = (e) => {
                // If they hit Enter or Escape, dismiss the modal cleanly
                if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault()
                    cleanUpAndClose()
                }
            }

            // 6. Wire listeners and pull back the visibility layout veil
            okBtn.addEventListener('click', handleOkClick)
            document.addEventListener('keydown', handleKeyDown)
            overlay.classList.remove('is-hidden')
            
            // Focus the OK button automatically so pressing Enter works right away
            okBtn.focus()
        })
    },

    // Prompts a binary choice modal (Confirm/Cancel)
    confirmModal: (title, message, confirmText = "Confirm") => {
        return new Promise((resolve) => {
            const overlay = document.getElementById('editor-modal-overlay')
            const titleEl = document.getElementById('editor-modal-title')
            const fieldsContainer = document.getElementById('editor-modal-fields')
            const form = document.getElementById('editor-modal-form')
            const cancelBtn = document.getElementById('editor-modal-cancel')
            
            // Grab the submit button inside the form to dynamically alter its text
            const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('.btn-submit')

            if (!overlay || !form || !fieldsContainer) return resolve(false)

            // 1. Inject setup text
            titleEl.textContent = title
            
            // 2. Clear old input elements, and insert a simple descriptive text node instead
            fieldsContainer.innerHTML = `
                <div class="modal-info-message theme-warning">
                    <div class="modal-info-icon">
                        <svg><use href="#icon-warning"/></svg>
                    </div>
                    <div class="modal-info-text">${message}</div>
                </div>
            `

            // Save original submit button text, then change it to what we need (e.g., "Delete")
            const originalSubmitText = submitBtn ? submitBtn.innerHTML : "Submit"
            if (submitBtn) {
                let svgIcon = ``
                if (confirmText.toLowerCase() === 'delete') {
                    submitBtn.classList.add('btn-danger')
                    svgIcon = `#icon-trash`
                } else {
                    svgIcon = `#icon-confirm`
                }

                submitBtn.innerHTML = `
                    <svg><use href="${svgIcon}"/></svg>
                    ${confirmText}
                    `
            }

            // 3. Make visible
            overlay.classList.remove('is-hidden')
            
            // Auto-focus the cancel button as a safety measure so pressing Enter doesn't accidentally delete
            cancelBtn?.focus()

            // 4. Teardown wrapper
            const close = (confirmed) => {
                overlay.classList.add('is-hidden')
                form.onsubmit = null
                cancelBtn.onclick = null
                
                // Restore original button attributes
                if (submitBtn) {
                    submitBtn.innerHTML = originalSubmitText
                    submitBtn.classList.remove('btn-danger')
                }
                
                resolve(confirmed)
            }

            // 5. Connect resolution triggers
            if (submitBtn) {
                submitBtn.onclick = (e) => {
                    e.preventDefault()
                    close(true)
                }
            }

            if (form) {
                form.onsubmit = (e) => {
                    e.preventDefault()
                    close(true)
                }
            }

            if (cancelBtn) {
                cancelBtn.onclick = (e) => {
                    e.preventDefault()
                    close(false)
                }
            }
        })
    },

    // Launches a non-blocking HTML modal interface and suspends execution until resolved.
    promptCustomModal: (title, fieldConfigs, deleteAccount=false) => {
        return new Promise((resolve) => {
            const overlay = document.getElementById('editor-modal-overlay')
            const modalCard = document.getElementById('editor-modal-card')
            const titleEl = document.getElementById('editor-modal-title')
            const fieldsContainer = document.getElementById('editor-modal-fields')
            const form = document.getElementById('editor-modal-form')
            const cancelBtn = document.getElementById('editor-modal-cancel')    
            const submitBtn = form?.querySelector('button[type="submit"]') || 
                            form?.querySelector('.btn-submit') || 
                            document.getElementById('editor-modal-submit')

            if (deleteAccount) {
                modalCard.classList.add('danger')
            }

            if (!overlay || !form || !fieldsContainer) return resolve(null)

            titleEl.textContent = title
            fieldsContainer.innerHTML = '' // Wipe old elements

            // 1. Generate fields dynamically
            fieldConfigs.forEach(field => {
                const labelNode = document.createElement('label')
                labelNode.className = 'modal-field-wrapper'
                
                if (field.type === 'select') {
                    // Find matching initial label text configuration parameters
                    const initialSelectedOpt = field.options.find(opt => opt.value === field.defaultValue) || field.options[0];
                    
                    // Generate structural options list rows
                    const optionsMarkup = field.options.map(opt => `
                        <div class="custom-dropdown-option ${opt.value === field.defaultValue ? 'is-selected' : ''}" data-value="${opt.value}">
                            ${opt.label}
                        </div>
                    `).join('')

                    // CUSTOM SELECTION SHELL INTERFACE ARCHITECTURE:
                    labelNode.innerHTML = `
                        <span class="field-label-text">${field.label}</span>
                        <div class="custom-dropdown-container" id="dropdown-${field.key}">
                            <div class="custom-dropdown-trigger">
                                <span class="trigger-text">${initialSelectedOpt ? initialSelectedOpt.label : 'Select an option'}</span>
                                <span class="trigger-caret"><svg><use href="#icon-dropdown"/></svg></span>
                            </div>
                            <div class="custom-dropdown-menu is-hidden">
                                ${optionsMarkup}
                            </div>
                            <input type="hidden" name="${field.key}" value="${initialSelectedOpt ? initialSelectedOpt.value : ''}" ${field.required ? 'required' : ''} />
                        </div>
                    `
                    
                    fieldsContainer.appendChild(labelNode)

                    // Bind isolated interaction event listeners immediately onto our newly created dropdown interface DOM nodes
                    const dropdownContainer = labelNode.querySelector('.custom-dropdown-container')
                    const trigger = dropdownContainer.querySelector('.custom-dropdown-trigger')
                    const menu = dropdownContainer.querySelector('.custom-dropdown-menu')
                    const hiddenInput = dropdownContainer.querySelector('input[type="hidden"]')
                    const triggerText = dropdownContainer.querySelector('.trigger-text')
                    const optionNodes = dropdownContainer.querySelectorAll('.custom-dropdown-option')

                    // Toggle menu visibility when clicking the trigger element box surface layout
                    trigger.addEventListener('click', (e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        
                        // Close any other open dropdowns inside the container to insulate the UI layout space
                        fieldsContainer.querySelectorAll('.custom-dropdown-menu').forEach(openMenu => {
                            if (openMenu !== menu) openMenu.classList.add('is-hidden')
                        })
                        
                        menu.classList.remove('is-hidden')
                    })

                    // Handle picking a custom row state change sequence parameters
                    optionNodes.forEach(option => {
                        option.addEventListener('click', (e) => {
                            e.preventDefault()
                            e.stopPropagation()

                            const newValue = option.getAttribute('data-value')
                            const newLabel = option.textContent.trim()

                            // Update text and synchronization payload tracks instantly
                            hiddenInput.value = newValue
                            triggerText.textContent = newLabel

                            // Update option active focus indicator highlights cleanly
                            optionNodes.forEach(opt => opt.classList.remove('is-selected'))
                            option.classList.add('is-selected')

                            // Close selection menu layer safely
                            menu.classList.add('is-hidden')
                        })
                    })

                } else {
                    labelNode.innerHTML = `
                        <span class="field-label-text">${field.label}</span>
                        <input 
                            type="${field.type || 'text'}" 
                            name="${field.key}" 
                            value="${field.defaultValue || ''}" 
                            placeholder="${field.placeholder || ''}" 
                            min="${field.min || ''}"
                            max="${field.max || ''}"
                            ${field.required ? 'required' : ''} 
                        />
                    `
                    fieldsContainer.appendChild(labelNode)
                }
            })

            // Global safety click catcher to auto-dismiss open menus when clicking away outside the boundaries
            const dismissDropdownMenus = (e) => {
                if (!e.target.closest('.custom-dropdown-container')) {
                    fieldsContainer.querySelectorAll('.custom-dropdown-menu').forEach(menu => menu.classList.add('is-hidden'))
                }
            }
            document.addEventListener('click', dismissDropdownMenus)

            overlay.classList.remove('is-hidden')
            fieldsContainer.querySelector('input:not([type="hidden"])')?.focus()

            // 4. Teardown wrapper to clean up event listeners and hide the overlay
            const close = (outputValue) => {
                overlay.classList.add('is-hidden')
                modalCard.classList.remove('danger')
                document.removeEventListener('click', dismissDropdownMenus) // Evacuate leaky listeners
                
                if (submitBtn) submitBtn.onclick = null
                form.onsubmit = null
                cancelBtn.onclick = null
                
                resolve(outputValue)
            }

            // 5. Connect resolution triggers
            form.onsubmit = (e) => {
                e.preventDefault()
                e.stopPropagation()
                
                try {
                    const formData = new FormData(form)
                    const results = {}
                    
                    fieldConfigs.forEach(field => {
                        const rawValue = formData.get(field.key)
                        if (rawValue !== null && typeof rawValue === 'string') {
                            results[field.key] = rawValue.trim()
                        } else {
                            results[field.key] = "" 
                        }
                    })
                    
                    close(results)
                    
                } catch (err) {
                    console.error("Critical layout error compiling custom modal form properties:", err)
                    close(null) 
                }
            }

            if (submitBtn) {
                submitBtn.onclick = (e) => {
                    if (!form.checkValidity()) return
                    
                    if (submitBtn.getAttribute('type') !== 'submit') {
                        e.preventDefault()
                        e.stopPropagation()
                        
                        const formData = new FormData(form)
                        const results = {}
                        fieldConfigs.forEach(field => {
                            const rawValue = formData.get(field.key)
                            results[field.key] = (rawValue !== null && typeof rawValue === 'string') ? rawValue.trim() : ""
                        })
                        close(results)
                    }
                };
            }

            cancelBtn.onclick = (e) => {
                e.preventDefault()
                e.stopPropagation()
                close(null)
            }
        })
    },

    // UI Polish: Loops through sidebar file explorer and highlights the current one
    highlightActiveSidebarItem: (noteID) => {
        document.querySelectorAll('.note-file').forEach(file => {
            if (file.getAttribute('data-id') === noteID) {
                file.setAttribute('data-is-selected', 'true')
            } else {
                file.removeAttribute('data-is-selected')
            }
        })
    },

    // Scans the editor text, parses headings, and updates the TOC UI component
    syncTableOfContents: (doc) => {
        const tocContainer = document.getElementById('toc-container')
        if (!tocContainer) return

        const headings = []

        // Idiomatic CodeMirror 6 Line Scan
        // CodeMirror lines are 1-indexed, running from 1 up to doc.lines inclusively
        for (let i = 1; i <= doc.lines; i++) {
            const lineText = doc.line(i).text
            
            // Match 1 to 6 hash marks followed by a required space, capturing the text after
            const headingMatch = lineText.match(/^(#{1,6})\s+(.+)$/)
            
            if (headingMatch) {
                headings.push({
                    level: headingMatch[1].length, // e.g., '##' evaluates to level 2
                    text: headingMatch[2].trim(),
                    lineNumber: i
                })
            }
        }

        // Clear out the old TOC DOM nodes completely
        tocContainer.innerHTML = ''

        // If no headers exist, show a clean empty state indicator
        if (headings.length === 0) {
            tocContainer.innerHTML = `<span class="toc-empty">No headings added yet</span>`
            return
        }

        // Loop through the found headers and append them to the DOM
        headings.forEach(heading => {
            const link = document.createElement('a')
            link.className = `toc-item toc-level-${heading.level}`
            link.textContent = heading.text
            
            // Store the target destination line as a custom data token
            link.setAttribute('data-target-line', heading.lineNumber)

            // Interactive jump-to-line event listener
            link.addEventListener('click', () => {
                if (!editorInstance) return

                // Look up line character bounds instantly
                const line = editorInstance.state.doc.line(heading.lineNumber)

                // Dispatch navigation block
                editorInstance.dispatch({
                    selection: { anchor: line.from },
                    scrollIntoView: true
                })

                // Refocus text workspace for seamless continuity
                editorInstance.focus()
            })

            tocContainer.appendChild(link)
        })
    },

    // Scans the editor, extracts internal links, cross-references our local cache,
    // and renders the Outgoing Links sidebar.
    syncOutgoingLinks: (doc, allNotes = []) => {
        const linksContainer = document.getElementById('links-container')
        if (!linksContainer) return

        // 1. Map our array of notes into a high-speed Lookup Dictionary
        const notesTitleMap = {}
        allNotes.forEach(note => {
            if (note.title) {
                notesTitleMap[note.title.toLowerCase().trim()] = note._id
            }
        })

        const extractedLinks = []

        // 2. Scan every line of the document
        for (let i = 1; i <= doc.lines; i++) {
            const line = doc.line(i) // Get full line object to access absolute positions
            const lineText = line.text

            // Pattern A: Match Wiki-links -> [[Some Note Title]]
            // Note: Wiki-links don't need a write-back! Once the note is created, 
            // notesTitleMap will automatically match the title on the next sync pass.
            const wikiMatches = [...lineText.matchAll(/\[\[(.*?)\]\]/g)]
            wikiMatches.forEach(match => {
                const title = match[1].trim()
                const lowerTitle = title.toLowerCase()
                
                extractedLinks.push({
                    type: 'wiki',
                    display: title,
                    targetTitle: title,
                    isGhost: !notesTitleMap[lowerTitle],
                    noteId: notesTitleMap[lowerTitle] || null
                })
            })

            // Pattern B: Match Standard Markdown links -> [Display Label](Note_ID_Or_Title)
            const mdMatches = [...lineText.matchAll(/\[(.*?)\]\((.*?)\)/g)]
            mdMatches.forEach(match => {
                const label = match[1].trim()
                const target = match[2].trim()
                
                // Ignore external web assets, email paths, or inner page anchors
                if (/^(https?:\/\/|www\.|mailto:|#)/i.test(target)) {
                    return 
                }

                // Clean up the target title if it uses our custom 'ghost:' protocol prefix
                const isGhostProtocol = target.startsWith('ghost:')
                const cleanTarget = isGhostProtocol ? decodeURIComponent(target.replace('ghost:', '')) : target

                const isDirectId = allNotes.some(n => n._id === target)
                const lowerTarget = cleanTarget.toLowerCase().trim()
                const idFromTitle = notesTitleMap[lowerTarget]

                // POSITION TRACKING ENGINE:
                // Calculate the exact absolute index where the text inside the parenthesis starts and ends
                const fullMatchString = match[0]
                const urlStartIndex = fullMatchString.indexOf('(') + 1
                const absoluteUrlFrom = line.from + match.index + urlStartIndex
                const absoluteUrlTo = absoluteUrlFrom + target.length

                if (isDirectId) {
                    const matchedNote = allNotes.find(n => n._id === target)
                    extractedLinks.push({
                        type: 'markdown',
                        display: label,
                        targetTitle: matchedNote.title,
                        isGhost: false,
                        noteId: target
                    })
                } else {
                    extractedLinks.push({
                        type: 'markdown',
                        display: label,
                        targetTitle: cleanTarget,
                        isGhost: !idFromTitle,
                        noteId: idFromTitle || null,
                        // Save the character range boundary inside CodeMirror coordinates
                        pos: { from: absoluteUrlFrom, to: absoluteUrlTo }
                    })
                }
            })
        }

        // 3. Clear and Render the UI Container
        linksContainer.innerHTML = ''

        if (extractedLinks.length === 0) {
            linksContainer.innerHTML = `<span class="links-empty">No outgoing connections</span>`
            return
        }

        // 4. Build DOM nodes, styling Ghost Links uniquely
        extractedLinks.forEach(link => {
            const item = document.createElement('div')
            item.className = `link-item ${link.isGhost ? 'is-ghost' : 'is-live'}`
            
            item.innerHTML = `
                <span class="link-icon"><svg><use href="#${link.isGhost ? 'icon-ghost' : 'icon-links'}"/></svg></span>
                <span class="link-label">${link.display}</span>
            `

            // 5. Wire navigation and modification interactions
            if (!link.isGhost) {
                item.addEventListener('click', () => {
                    EditorView.loadNote(link.noteId)
                })
            } else {
                // Ghost Link Event: Create a new note automatically using this title
                item.addEventListener('click', async () => {
                    try {
                        const generatedNote = await noteService.createNote(link.targetTitle)
                        
                        // 6. CODEBIODIRECTIONAL WRITE-BACK:
                        // If it's a standard markdown link template, replace 'ghost:...' with the true ID
                        if (link.type === 'markdown' && link.pos && editorInstance) {
                            editorInstance.dispatch({
                                changes: {
                                    from: link.pos.from,
                                    to: link.pos.to,
                                    insert: generatedNote._id
                                }
                            })

                            // Extract the fully updated document string from CodeMirror
                            const updatedDocumentText = editorInstance.state.doc.toString()

                            if (currentNoteId) {
                                console.log(`💾 Persisting link write-back to database for note: ${currentNoteId}`)
                                
                                // Fire our backend service update call to lock the changes into MongoDB
                                await noteService.updateNote(currentNoteId, { content: updatedDocumentText })
                            }

                        }

                        // Update the Cache
                        cachedNotes.push(generatedNote)

                        // Update the explorer
                        EditorView.renderExplorer()

                        // Transition view context to the newly instantiated document profile
                        EditorView.loadNote(generatedNote._id)
                    } catch (err) {
                        console.error("Ghost link generation crash:", err)
                        await EditorView.alertModal('Ghost link generation failed', 'error')
                    }
                })
            }

            linksContainer.appendChild(item)
        })
    },

    // Loops through our local cache and populates the explorer tab
    renderExplorer: () => {
        const explorerContainer = document.getElementById('explorer-container')
        if (!explorerContainer) return

        // 1. Wipe old DOM nodes out of the nav container
        explorerContainer.innerHTML = ''

        // 2. Empty state protection
        if (cachedNotes.length === 0) {
            explorerContainer.innerHTML = `<span class="explorer-empty">No notes yet</span>`
            return
        }

        // 3. Construct the list links
        cachedNotes.forEach(note => {
            const navItem = document.createElement('div')
            navItem.className = 'explorer-item'

            const navLink = document.createElement('div')
            navLink.className = 'explorer-nav-item'
            
            // Highlight this item if it matches our active opened note pointer
            if (note._id === currentNoteId) {
                navItem.classList.add('is-active')
            }

            navLink.innerHTML = `
                <span class="nav-item-icon"><svg><use href="#icon-note"/></svg></span>
                <span class="nav-item-title">${note.title || 'Untitled Note'}</span>
            `

            const deleteNoteBtn = document.createElement('div')
            deleteNoteBtn.className = 'explorer-delete-note-btn'
            deleteNoteBtn.innerHTML = `<svg><use href="#icon-trash" /></svg>`

            // 4. Click event to seamlessly load the selected note
            navLink.addEventListener('click', () => {
                EditorView.loadNote(note._id)
            })
            // Click event to delete corresponding note
            deleteNoteBtn.addEventListener('click', async (e) => {
                // Stop the event from bubbling up to the nav link row
                e.stopPropagation()

                // PROTECTION LOCK: Ensure this event ONLY belongs to the explorer sidebar trash button!
                // If the event target is inside the modal wrapper, block execution instantly.
                if (e.target.closest('#editor-modal-overlay') || e.target.closest('#editor-modal-form')) {
                    console.warn("⚠️ Deletion blocked: Intercepted a stray event bubbling from the modal overlay layout.")
                    return
                }

                console.log("Trash icon clicked for note:", note.title)

                const targetIdToDelete = note._id
                const targetTitleToDelete = note.title || 'Untitled Note'

                // Open the confirmation modal frame
                const confirmed = await EditorView.confirmModal(
                    `Delete Note?`,
                    `Are you sure you want to permanently delete the note '${targetTitleToDelete}'? This cannot be undone.`,
                    `Delete`
                )

                if (!confirmed) {
                    console.log("Note deletion aborted by user.")
                    return // Break execution early
                }

                try {
                    const result = await noteService.deleteNote(targetIdToDelete)
                        
                    const freshIndex = cachedNotes.findIndex(n => n._id === targetIdToDelete)
                    
                    if (freshIndex !== -1) {
                        cachedNotes.splice(freshIndex, 1)
                    }

                    await EditorView.alertModal("Note removed successfully.", "success")
                    
                    if (targetIdToDelete === currentNoteId) {
                        currentNoteId = null 
                        
                        if (cachedNotes.length > 0) {
                            EditorView.loadNote(cachedNotes[0]._id)
                        } else {
                            const splashShell = document.getElementById('welcome-splash-shell')
                            const editorShell = document.getElementById('editor-workspace-shell')
                            if (editorShell) editorShell.setAttribute('data-is-hidden', 'true')
                            if (splashShell) splashShell.removeAttribute('data-is-hidden')
                        }
                    }

                    EditorView.renderExplorer()
                } catch (error) {
                    console.error("❌ Deletion lifecycle failure caught in try/catch:", error)
                    await EditorView.alertModal(`Failed to delete note: ${error.message}`, "error")
                }
            })

            navItem.appendChild(navLink)
            navItem.appendChild(deleteNoteBtn)
            explorerContainer.appendChild(navItem)
        })
    },

    // Updates a single note's title inside our local memory cache array
    updateCachedTitle: (noteId, newTitle) => {
        const cachedNote = cachedNotes.find(n => n._id === noteId)
        if (cachedNote) {
            cachedNote.title = newTitle
            console.log(`Cache updated: Note ${noteId} title is now "${newTitle}"`)
            
            // REACTIVE HOOK: Re-render the explorer immediately when a title updates
            EditorView.renderExplorer()
        }
    },

    // Filtering by Tag system
    renderExplorerFilters: () => {
        const activeContainer = document.getElementById('explorer-active-filters')
        const availableContainer = document.getElementById('explorer-available-tags')
        if (!activeContainer || !availableContainer) return

        activeContainer.innerHTML = ''
        availableContainer.innerHTML = ''

        // 1. Render Active Filters Section
        if (activeFilters.length === 0) {
            activeContainer.innerHTML = `<span class="filter-placeholder">Showing all notes</span>`
        } else {
            activeFilters.forEach(tagId => {
                const tag = cachedTags.find(t => t._id === tagId)
                if (!tag) return

                const chip = document.createElement('div')
                chip.className = 'tag-chip is-active'
                chip.style.backgroundColor = tag.color
                chip.innerHTML = `${tag.name} <span class="remove-x">&times;</span>`
                
                // Clicking removes it from filtering
                chip.addEventListener('click', () => {
                    activeFilters = activeFilters.filter(id => id !== tagId)
                    EditorView.renderExplorerFilters()
                    EditorView.executeFilterPipeline()
                })
                activeContainer.appendChild(chip)
            })
        }

        // 2. Render Available Global Tags for Filtering
        cachedTags.forEach(tag => {
            // Skip if it's already an active filter
            if (activeFilters.includes(tag._id)) return

            const chip = document.createElement('div')
            chip.className = 'tag-chip available'
            chip.style.borderColor = tag.color
            chip.style.color = tag.color
            chip.textContent = tag.name

            // Clicking adds it to filtering
            chip.addEventListener('click', () => {
                activeFilters.push(tag._id)
                EditorView.renderExplorerFilters()
                EditorView.executeFilterPipeline()
            })
            availableContainer.appendChild(chip)
        })
    },

    executeFilterPipeline: async () => {
        try {
            if (activeFilters.length === 0) {
                cachedNotes = await noteService.getAllNotes()
            } else {
                cachedNotes = await noteService.getNotesByTags(activeFilters)
            }
            EditorView.renderExplorer() // Refresh note list
        } catch (err) {
            console.error("Filter request failed:", err)
            await EditorView.alertModal(`Filter request failed`, 'error')
        }
    },

    // Tag Management system
    renderTagInspector: async () => {
        const noteTagsContainer = document.getElementById('manager-note-tags')
        const globalTagsContainer = document.getElementById('manager-global-tags')
        if (!noteTagsContainer || !globalTagsContainer || !currentNoteId) return

        // Fetch the fresh note object to see its assigned tags array
        const currentNote = await noteService.getNoteById(currentNoteId)
        const assignedTagIds = currentNote.tags || []

        noteTagsContainer.innerHTML = ''
        globalTagsContainer.innerHTML = ''

        // 1. Render Section: Assigned Tags (Clicking removes them)
        if (assignedTagIds.length === 0) {
            noteTagsContainer.innerHTML = `<span class="inspector-empty">No tags on this note</span>`
        } else {
            assignedTagIds.forEach(tagId => {
                const tag = cachedTags.find(t => t._id === tagId)
                if (!tag) return

                const chip = document.createElement('div')
                chip.className = 'tag-chip assigned'
                chip.style.backgroundColor = tag.color
                chip.innerHTML = `${tag.name} &times;`

                // Toggle off on click
                chip.addEventListener('click', async () => {
                    const updatedNote = await noteService.removeTagFromNote(currentNoteId, tag._id) 
                    EditorView.renderTagInspector() // Re-render inspector view
                })
                noteTagsContainer.appendChild(chip)
            })
        }

        // 2. Render Section: Global Pool for Toggling
        cachedTags.forEach(tag => {
            const isAlreadyAssigned = assignedTagIds.includes(tag._id)

            const chip = document.createElement('div')
            chip.className = `tag-chip library-item ${isAlreadyAssigned ? 'has-it' : ''}`
            const chipName = document.createElement('div')
            chipName.className = `tag-item-name`
            chipName.innerText = tag.name
            const chipDeleteBtn = document.createElement('div')
            chipDeleteBtn.className = 'tag-delete-btn'
            chipDeleteBtn.innerHTML = `<svg><use href="#icon-trash" /></svg>`
            chip.appendChild(chipName)
            chip.appendChild(chipDeleteBtn)
            
            if (isAlreadyAssigned) {
                chip.style.backgroundColor = tag.color
            } else {
                chip.style.borderColor = tag.color
                chip.style.color = tag.color
            }

            // The Toggle Behavior: Add if missing, remove if present
            chip.addEventListener('click', async () => {
                if (isAlreadyAssigned) {
                    await noteService.removeTagFromNote(currentNoteId, tag._id)
                } else {
                    await noteService.addTagToNote(currentNoteId, tag._id) 
                }
                EditorView.renderTagInspector()
            })

            // Delete Tag Logic
            chipDeleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation()

                const confirmed = await EditorView.confirmModal(
                    `Delete Tag?`,
                    `Are you sure you want to permanently delete the tag ${tag.name}? This cannot be undone.`,
                    `Delete`
                )

                if (!confirmed) {
                    console.log("Tag deletion aborted by user.")
                    return // Break execution early
                }

                // Trigger the rest of the pipeline if true
                try {
                    console.log(`Executing deletion pipeline for tag ID: ${tag._id}`)
                    const result = await tagService.deleteTagById(tag._id)
                    console.log("Tag server raw response data received:", result)

                    // Remove the deleted tag from our global tracking cache array in memory
                    if (typeof cachedTags !== 'undefined') {
                        const targetTagId = tag._id
                        const freshTagIndex = cachedTags.findIndex(t => (t._id || t.id) === targetTagId)
                        if (freshTagIndex !== -1) {
                            cachedTags.splice(freshTagIndex, 1)
                            console.log("Tag removed safely from cachedTags state tracking array.")
                        }
                    }

                    // 1. Re-render the tag manager panel interface with the updated cache array
                    EditorView.renderTagInspector()
                    
                    // 2. Inform user via notification alert modal using your backend payload string
                    await EditorView.alertModal(result.message || "Tag removed successfully.", "success")
                    
                } catch (error) {
                    console.error("❌ Tag deletion render crash intercepted:", error)
                    
                    // Fallback to prevent layout updates from showing false network error warnings
                    await EditorView.alertModal(`Failed to update tag layouts: ${error.message}`, "error")
                }
            })

            globalTagsContainer.appendChild(chip)
        })
    },

    // Converts the raw editor string into HTML elements and compiles them into the preview container
    syncLivePreview: (rawText) => {
        const previewContainer = document.getElementById('note-preview-container')
        if (!previewContainer || !editorInstance) return

        // Force counter back to zero BEFORE parsing the new text string block
        imageRenderCount = 0

        // If no text is provided (or it's called without args), fall back safely
        const textToParse = rawText !== undefined ? rawText : editorInstance?.state.doc.toString() || ""
        
        // Compile Markdown string directly to safe HTML string
        previewContainer.innerHTML = marked.parse(textToParse)

        // Attach resize handlers to the images
        attachImageResizeHandlers(previewContainer, editorInstance)
    },

    // Alternates workspace layouts between the view modes
    toggleViewMode: (mode) => {
        const editorEl = document.getElementById('view-md')
        const previewEl = document.getElementById('view-preview')

        if (!editorEl || !previewEl) return

        switch (mode) {
            case "mdOnly":
                isPreviewMode = false
                previewEl.setAttribute('data-is-hidden', 'true')
                editorEl.removeAttribute('data-is-hidden')
                break
            case "splitView":
                isPreviewMode = true
                previewEl.removeAttribute('data-is-hidden')
                editorEl.removeAttribute('data-is-hidden')
                // Populate the HTML immediately on click 
                EditorView.syncLivePreview(editorInstance.state.doc.toString())
                break
            case "livePreview":
                isPreviewMode = true
                previewEl.removeAttribute('data-is-hidden')
                editorEl.setAttribute('data-is-hidden', 'true')
                // Populate the HTML immediately on click 
                EditorView.syncLivePreview(editorInstance.state.doc.toString())
                break
        }

        // Update active button classes
        EditorView.updateViewButtonStates(mode)

        // Return cursor focus to the text engine instantly
        editorInstance.focus()
    },

    // Update active button classes for the view options
    updateViewButtonStates: (mode) => {
        const viewMD = document.getElementById('settings-view-md')
        const viewSplit = document.getElementById('settings-view-split')
        const viewPreview = document.getElementById('settings-view-preview')

        viewMD.classList.remove('is-active')
        viewSplit.classList.remove('is-active')
        viewPreview.classList.remove('is-active')

        if (mode === "mdOnly") viewMD?.classList.add('is-active')
        if (mode === "splitView") viewSplit?.classList.add('is-active')
        if (mode === "livePreview") viewPreview?.classList.add('is-active')
    },

    // Binds the editor and preview containers together for synchronized scrolling
    setupScrollSync: () => {
        const previewContainer = document.getElementById('note-preview-container')
        // CodeMirror 6 exposes its native scrollable element via .scrollDOM
        const editorScroller = editorInstance?.scrollDOM

        if (!previewContainer || !editorScroller) return

        // Flags to prevent infinite scroll event mirroring loops
        let isSyncingEditorScroll = false
        let isSyncingPreviewScroll = false

        // Helper function to scroll target proportionally based on source position
        const syncScroll = (source, target) => {
            const sourceAvailableScroll = source.scrollHeight - source.clientHeight
            if (sourceAvailableScroll <= 0) return

            // 🎯 GUARD 1: Strict Top Snapping
            // If the source element is at the very top (or within a 2px rounding threshold),
            // force the target element to the absolute top (0) and exit early.
            if (source.scrollTop <= 2) {
                target.scrollTop = 0
                return
            }

            const targetAvailableScroll = target.scrollHeight - target.clientHeight

            // 🎯 GUARD 2: Strict Bottom Snapping
            // If the source element hits the absolute bottom, force the target to the bottom.
            if (source.scrollTop >= sourceAvailableScroll - 2) {
                target.scrollTop = targetAvailableScroll
                return
            }

            // Proportional Fallback for normal scrolling
            // Calculate current decimal percentage (0.0 to 1.0)
            const scrollPercentage = source.scrollTop / sourceAvailableScroll

            // Apply percentage to the target's unique scrollable height
            target.scrollTop = scrollPercentage * targetAvailableScroll
        }

        // 1. Listen for Editor Scrolling
        editorScroller.addEventListener('scroll', () => {
            if (!isPreviewMode) return // Only sync if split view is actively open

            if (isSyncingPreviewScroll) {
                isSyncingPreviewScroll = false // Reset flag and ignore mirrored event
                return
            }

            isSyncingEditorScroll = true
            syncScroll(editorScroller, previewContainer)
        })

        // 2. Listen for Preview Scrolling
        previewContainer.addEventListener('scroll', () => {
            if (!isPreviewMode) return

            if (isSyncingEditorScroll) {
                isSyncingEditorScroll = false // Reset flag and ignore mirrored event
                return
            }

            isSyncingPreviewScroll = true
            syncScroll(previewContainer, editorScroller)
        })
    },

    // Applies Word-style stackable text formatting commands across active selections or cursor points.
    applyTextFormat: (formatType) => {
        if (!editorInstance) return

        const formatMap = {
            bold: { open: "**", close: "**" },
            italic: { open: "_", close: "_" },
            underline: { open: "<u>", close: "</u>" },
            strikethrough: { open: "~~", close: "~~" },
            subscript: { open: "<sub>", close: "</sub>" },
            superscript: { open: "<sup>", close: "</sup>" },
            code: { open: "`", close: "`" }
        }

        const { open, close } = formatMap[formatType]
        const state = editorInstance.state

        const transactionSpec = state.changeByRange((range) => {
            if (!range.empty) {
                // ================================================================
                // CASE 1: TEXT IS HIGHLIGHTED (Smart Wrap / Unwrap Engine)
                // ================================================================
                const selectedText = state.doc.sliceString(range.from, range.to)
                
                // Look closely at the characters immediately preceding and succeeding the selection
                const beforeText = state.doc.sliceString(range.from - open.length, range.from)
                const afterText = state.doc.sliceString(range.to, range.to + close.length)

                // Scenario A: The formatting tags are sitting OUTSIDE the selection text boundary
                // Example: **|hello|**
                if (beforeText === open && afterText === close) {
                    return {
                        changes: [
                            { from: range.from - open.length, to: range.from, insert: "" },
                            { from: range.to, to: range.to + close.length, insert: "" }
                        ],
                        // Shift the highlight back to match the newly shifted coordinates of the raw text
                        range: EditorSelection.range(range.from - open.length, range.to - open.length)
                    }
                }
                
                // Scenario B: The user highlighted the tags INSIDE their selection span
                // Example: |**hello**|
                if (selectedText.startsWith(open) && selectedText.endsWith(close) && selectedText.length >= (open.length + close.length)) {
                    const unwrappedText = selectedText.slice(open.length, -close.length)
                    return {
                        changes: [
                            { from: range.from, to: range.to, insert: unwrappedText }
                        ],
                        range: EditorSelection.range(range.from, range.from + unwrappedText.length)
                    }
                }

                // Default Fallback: The text isn't styled yet! Apply the formatting wrappers normally
                return {
                    changes: [
                        { from: range.from, insert: open },
                        { from: range.to, insert: close }
                    ],
                    range: EditorSelection.range(range.from + open.length, range.to + open.length)
                }

            } else {
                // ================================================================
                // CASE 2: NO SELECTION
                // ================================================================
                const lookAheadText = state.doc.sliceString(range.from, range.from + close.length)

                if (lookAheadText === close) {
                    // Toggle off typing format -> Jump cursor past closing tag
                    return {
                        changes: [],
                        range: EditorSelection.cursor(range.from + close.length)
                    };
                } else {
                    // Toggle on typing format -> Drop token sandbox and position cursor inside
                    return {
                        changes: [
                            { from: range.from, insert: open + close }
                        ],
                        range: EditorSelection.cursor(range.from + open.length)
                    }
                }
            }
        })

        // Execute transaction updates across CodeMirror
        editorInstance.dispatch(transactionSpec)
        editorInstance.focus()
    },

    // Inserts or wraps text in standard Markdown link syntax [text](url)
    // Also supports targeting local internal workspace note records
    insertLink: async (availableNotes = []) => {
        if (!editorInstance) return

        // 1. Build out our select options array
        const noteOptions = [
            { value: "", label: "-- None (Use External URL or Ghost Note) --" },
            ...availableNotes.map(note => {
                const actualId = note._id || note.id
                return {
                    value: actualId || "",
                    label: note.title || "Untitled Note"
                }
            })
        ]

        // 2. Open our upgraded modal. All fields are optional (required: false) 
        // so they don't fight native browser validation constraints.
        const inputData = await EditorView.promptCustomModal("Insert Link Asset", [
            { key: "url", label: "External Destination Link URL", defaultValue: "", placeholder: "https://example.com", required: false },
            { key: "noteId", label: "Or Link to an Existing Internal Note", type: "select", defaultValue: "", options: noteOptions, required: false },
            { key: "ghostNote", label: "Or Link to a New Note That Doesn't Exist Yet (Ghost Note)", type: "text", placeholder: "Enter new note title...", required: false }
        ])

        if (!inputData) return; // User cancelled execution

        let targetPath = ""
        let isInternalLink = false
        let selectedNoteTitle = ""

        // 3. PRIORITY 1: Existing Internal Note Checked
        if (inputData.noteId && inputData.noteId !== "undefined" && inputData.noteId !== "") {
            const chosenNote = availableNotes.find(n => (n._id || n.id) === inputData.noteId)
            if (chosenNote) {
                targetPath = chosenNote._id || chosenNote.id
                selectedNoteTitle = chosenNote.title || "Untitled Note"
                isInternalLink = true
            }
        } 
        // 4. PRIORITY 2: New Ghost Note Checked
        else if (inputData.ghostNote && inputData.ghostNote.trim() !== "") {
            const ghostTitle = inputData.ghostNote.trim()
            // Use a unique URI prefix string so your markdown parser can flag it as a creation trigger
            targetPath = `ghost:${encodeURIComponent(ghostTitle)}`
            selectedNoteTitle = ghostTitle
            isInternalLink = true // Treats as internal for text insertion automation rules
        } 
        // 5. PRIORITY 3: Fallback straight to External URL target configurations
        else if (inputData.url && inputData.url.trim() !== "") {
            targetPath = inputData.url.trim()
        } else {
            // If they click submit with totally blank values, abort to prevent bad markdown output
            return 
        }

        const state = editorInstance.state

        // 6. Run the CodeMirror structural multi-range transaction mapping
        const transactionSpec = state.changeByRange((range) => {
            let displayLabel = ""
            let replacement = ""

            if (!range.empty) {
                // CASE A: Text is highlighted by the user -> wrap it cleanly
                displayLabel = state.doc.sliceString(range.from, range.to)
                replacement = `[${displayLabel}](${targetPath})`
                
                return {
                    changes: [{ from: range.from, to: range.to, insert: replacement }],
                    range: EditorSelection.range(range.from + 1, range.from + 1 + displayLabel.length)
                }
            } else {
                // CASE B: Empty cursor placement -> auto-populate text labels for internal note contexts
                displayLabel = isInternalLink ? selectedNoteTitle : ""
                replacement = `[${displayLabel}](${targetPath})`

                const cursorPosition = isInternalLink 
                    ? range.from + replacement.length 
                    : range.from + 1

                return {
                    changes: [{ from: range.from, insert: replacement }],
                    range: EditorSelection.cursor(cursorPosition)
                }
            }
        })

        editorInstance.dispatch(transactionSpec)
        editorInstance.focus()
    },

    // Manages block-level formatting lines like Headings, Unordered Lists, and Ordered Lists.
    // Fully supports multi-line highlights and intelligent ordered list auto-numbering sequences.
    toggleLineFormat: (blockType) => {
        if (!editorInstance) return

        const state = editorInstance.state
        const prefixMap = {
            h1: "# ",
            h2: "## ",
            h3: "### ",
            ul: "- ",
            ol: "1. "
        }

        const targetPrefix = prefixMap[blockType]

        // Helper analyzer to identify if a line already matches the targeted layout rule
        const isMatchingBlock = (lineText, type) => {
            if (type === 'h1') return /^#\s/.test(lineText)
            if (type === 'h2') return /^##\s/.test(lineText)
            if (type === 'h3') return /^###\s/.test(lineText)
            if (type === 'ul') return /^-\s/.test(lineText)
            if (type === 'ol') return /^\d+\.\s/.test(lineText)
            return false
        }

        const transactionSpec = state.changeByRange((range) => {
            const startLineObj = state.doc.lineAt(range.from)
            let endLineNum = state.doc.lineAt(range.to).number

            // UX Edge-Case Protection: If a user selects multiple lines and their selection
            // stops exactly at character 0 of the next line, drop down 1 line so we don't 
            // accidentally format an extra empty line.
            if (range.to > range.from && state.doc.lineAt(range.to).from === range.to) {
                endLineNum--
            }

            // Gather all line objects encompassed by this block highlight range
            const linesToModify = []
            for (let i = startLineObj.number; i <= endLineNum; i++) {
                linesToModify.push(state.doc.line(i))
            }

            // Rule: If ALL selected lines already match the target layout, we are stripping it (TOGGLE OFF).
            // Otherwise, we are formatting/converting them all collectively (TOGGLE ON / SWAP).
            const allLinesMatchTarget = linesToModify.every(line => isMatchingBlock(line.text, blockType))

            const changes = []
            let cumulativeShift = 0
            let newFrom = range.from
            let newTo = range.to
            
            let olCounter = 1 // Tracks index counts to generate sequential numbers

            linesToModify.forEach((line) => {
                const lineText = line.text
                const existingPrefixMatch = lineText.match(/^(#+\s|-\s|\d+\.\s)/)
                
                // Generate standard prefix or custom sequential tracking digits for ordered sets
                const currentTargetPrefix = blockType === 'ol' ? `${olCounter}. ` : targetPrefix
                olCounter++

                if (allLinesMatchTarget) {
                    // MODE A: TOGGLE OFF (Strip matching syntax markers clean away)
                    if (existingPrefixMatch) {
                        const currentPrefix = existingPrefixMatch[0]
                        changes.push({ from: line.from, to: line.from + currentPrefix.length, insert: "" })
                        
                        if (line.number === startLineObj.number) {
                            newFrom = Math.max(line.from, range.from - currentPrefix.length)
                        }
                        cumulativeShift -= currentPrefix.length
                    }
                } else {
                    // MODE B: TOGGLE ON / CONVERT MIXED BLOCKS
                    if (existingPrefixMatch) {
                        // 🔄 SWAP: Switch out the old mismatching syntax token for the new prefix
                        const currentPrefix = existingPrefixMatch[0]
                        changes.push({ from: line.from, to: line.from + currentPrefix.length, insert: currentTargetPrefix })
                        
                        const deltaLength = currentTargetPrefix.length - currentPrefix.length
                        if (line.number === startLineObj.number) {
                            newFrom = range.from + deltaLength
                        }
                        cumulativeShift += deltaLength
                    } else {
                        // INSERT: Line has no existing block formatting; inject fresh markdown tokens
                        changes.push({ from: line.from, insert: currentTargetPrefix })
                        
                        if (line.number === startLineObj.number) {
                            newFrom = range.from + currentTargetPrefix.length
                        }
                        cumulativeShift += currentTargetPrefix.length
                    }
                }
            })

            // Extrapolate ending selection index bounds based on character shifting deltas
            newTo = range.to + cumulativeShift
            if (newTo < newFrom) newTo = newFrom // Guard check

            return {
                changes: changes,
                range: EditorSelection.range(newFrom, newTo)
            }
        })

        // Fire the completed atomic batch change event to the view canvas container
        editorInstance.dispatch(transactionSpec)
        editorInstance.focus()
    },

    // Injects layout structures, asset references, and block dividers into the canvas workspace.
    // Automatically maps cursor focus depths to maximize writing flow.
    insertStructure: async (structureType) => {
        if (!editorInstance) return

        const state = editorInstance.state
        let isAborted = false

        // Read CodeMirror's main cursor/selection range directly from the active state
        const mainRange = state.selection.main
        const selectedText = state.doc.sliceString(mainRange.from, mainRange.to)
        
        let snippet = ""
        let cursorSelectionOffset = 0 // Where the cursor sits inside the fresh block

        switch (structureType) {
            case "table":
                // 1. Call prompt modal with columns, rows, AND layout alignment selectors
                const tableSpecs = await EditorView.promptCustomModal("Configure Table Grid", [
                    { key: "cols", label: "Columns Count", type: "number", defaultValue: "3", min: "1" },
                    { key: "rows", label: "Data Rows Count", type: "number", defaultValue: "2", min: "1" },
                    { 
                        key: "align", 
                        label: "Text Alignment Column Rule", 
                        type: "select", 
                        defaultValue: "left",
                        options: [
                            { value: "left", label: "Left Aligned (Default)" },
                            { value: "center", label: "Centered Alignment" },
                            { value: "right", label: "Right Aligned" }
                        ]
                    }
                ])

                if (!tableSpecs) {
                    isAborted = true
                    break
                }

                const cols = parseInt(tableSpecs.cols, 10) || 3
                const rows = parseInt(tableSpecs.rows, 10) || 2
                const align = tableSpecs.align

                let tableLines = []

                // A. Build Header Row Array
                const headers = Array.from({ length: cols }, (_, i) => ` Header ${i + 1} `)
                tableLines.push(`|${headers.join('|')}|`)

                // B. Build Smart Alignment Dividers Array
                const dividers = Array.from({ length: cols }, () => {
                    if (align === 'center') return " :---: "
                    if (align === 'right') return "  ---: "
                    return " :---  " // Default Left Alignment standard syntax token
                })
                tableLines.push(`|${dividers.join('|')}|`)

                // C. Build Empty Content Fill Blocks Array
                for (let r = 0; r < rows; r++) {
                    const cells = Array.from({ length: cols }, () => " Cell     ")
                    tableLines.push(`|${cells.join('|')}|`)
                }

                snippet = `\n${tableLines.join('\n')}\n`
                cursorSelectionOffset = snippet.indexOf("Cell     ")
                break

            case "picture":
                const imageValues = await EditorView.promptCustomModal("Link Graphic Asset", [
                    { key: "altText", label: "Alt Text Description", defaultValue: "Image" },
                    { key: "imageUrl", label: "Asset Image URL", defaultValue: "https://" },
                    { key: "size", label: "Resize Image (Optional)", placeholder: "e.g., 300, 50%, or 400x250" }
                ])

                if (!imageValues || imageValues.imageUrl === "https://") {
                    isAborted = true
                    break
                }

                // Append the sizing modifier if the user provided one
                let sizingNotation = ""
                if (imageValues.size && imageValues.size.trim()) {
                    const cleanSize = imageValues.size.trim().replace(/^=/, '') // Strip leading '=' if typed by habit
                    sizingNotation = ` =${cleanSize}`
                }

                snippet = `![${imageValues.altText}](${imageValues.imageUrl}${sizingNotation})`
                cursorSelectionOffset = snippet.length
                break

            case "codeblock":
                // Preserves highlighted lines if the user wraps existing code snippets
                const interiorCode = selectedText || "// write code here"
                snippet = `\n\`\`\`\n${interiorCode}\n\`\`\`\n`
                cursorSelectionOffset = snippet.indexOf(interiorCode)
                break

            case "quote":
                // If they highlighted multiple code/text lines, add blockquote carats to all lines cleanly
                if (selectedText.includes("\n")) {
                    snippet = selectedText.split("\n").map(line => `> ${line}`).join("\n")
                    cursorSelectionOffset = snippet.length
                } else {
                    const quoteContent = selectedText || "Blockquote"
                    snippet = `\n> ${quoteContent}\n`
                    cursorSelectionOffset = snippet.indexOf(quoteContent)
                }
                break

            case "divider":
                // Drops a standard typographic horizontal rule item bounded by breath room lines
                snippet = "\n\n---\n\n"
                cursorSelectionOffset = snippet.length
                break

            default:
                // Simply return to exit early if an unhandled action is called
                return 
        }

        if (isAborted) return

        // Apply the transaction spec across ranges uniformly
        const transactionSpec = state.changeByRange((range) => {
            return {
                changes: [{ from: range.from, to: range.to, insert: snippet }],
                range: EditorSelection.cursor(range.from + cursorSelectionOffset)
            }
        })
        
        editorInstance.dispatch(transactionSpec)

        // Maintain active canvas execution focus seamlessly
        editorInstance.focus()
    },

    // Executes core clipboard interactions utilizing the modern async Web Clipboard API
    // Fully supports multi-cursor selections and history state tracking.
    executeClipboardAction: async (actionType) => {
        if (!editorInstance) return

        const state = editorInstance.state

        // ================================================================
        // MODE A: COPY & CUT PIPELINES
        // ================================================================
        if (actionType === 'copy' || actionType === 'cut') {
            // Collect text fragments from all active highlighted selection splits
            const selectedTexts = state.selection.ranges
                .map(range => state.doc.sliceString(range.from, range.to))
                .filter(text => text.length > 0)

            // Abort early if the user has no text selected
            if (selectedTexts.length === 0) return

            // Merge fragments cleanly using a newline separator if multi-selections exist
            const combinedText = selectedTexts.join('\n')

            try {
                await navigator.clipboard.writeText(combinedText)
            } catch (err) {
                console.error("System clipboard write access denied:", err)
                return
            }

            // If performing a cut execution, surgically erase the highlighted ranges
            if (actionType === 'cut') {
                const transactionSpec = state.changeByRange((range) => {
                    return {
                        changes: [{ from: range.from, to: range.to, insert: "" }],
                        range: EditorSelection.cursor(range.from)
                    }
                })
                editorInstance.dispatch(transactionSpec)
            }

        // ================================================================
        // MODE B: PASTE PIPELINE
        // ================================================================
        } else if (actionType === 'paste') {
            try {
                // Grab raw string data from the user's operating system clipboard
                const pastedText = await navigator.clipboard.readText()
                if (!pastedText) return

                // Run a transactional multi-insertion mapping array across current cursors
                const transactionSpec = state.changeByRange((range) => {
                    return {
                        changes: [{ from: range.from, to: range.to, insert: pastedText }],
                        // Position cursor right at the tail end of the newly dropped text content
                        range: EditorSelection.cursor(range.from + pastedText.length)
                    }
                })

                editorInstance.dispatch(transactionSpec)
            } catch (err) {
                console.warn(
                    "Clipboard read blocked. Ensure browser permission dialog access is granted.", 
                    err
                )
                await EditorView.alertModal('Clipboard read blocked. Ensure browser permission access is granted.')
            }
        }

        // Return active system focus smoothly to the writing container
        editorInstance.focus()
    },

    // Dispatches history modification triggers (Undo/Redo) directly to the CodeMirror core.
    executeHistoryAction: (actionType) => {
        if (!editorInstance) return

        if (actionType === 'undo') {
            undo(editorInstance)
        } else if (actionType === 'redo') {
            redo(editorInstance)
        }

        // Keep the focus on the editor so typing can resume seamlessly
        editorInstance.focus()
    },

    // Highlights all occurrences of a word/phrase using our custom async modal interface
    highlightOccurrences: async () => {
        if (!editorInstance) return

        // Await query strings using our modular modal system
        const searchSpecs = await EditorView.promptCustomModal("Highlight Occurrences", [
            { key: "query", label: "Find Text Phrase", placeholder: "Type word or sentence..." }
        ])

        if (!searchSpecs || !searchSpecs.query) return

        // Dispatch the effect into CodeMirror alongside the current document string
        editorInstance.dispatch({
            effects: setHighlightEffect.of({
                query: searchSpecs.query,
                docText: editorInstance.state.doc.toString()
            })
        })
    },

    // Selects every single character in the current note view frame
    selectAllText: () => {
        if (!editorInstance) return
        selectAll(editorInstance)
        editorInstance.focus()
    },

    // Shifts selected text block positions up or down sequentially
    moveLines: (direction) => {
        if (!editorInstance) return

        if (direction === 'up') {
            moveLineUp(editorInstance)
        } else if (direction === 'down') {
            moveLineDown(editorInstance)
        }
        editorInstance.focus()
    },

    // Renders a list layout switcher inside the global modal overlay frame
    // Resolves asynchronously with the user's selected note payload metadata
    promptNoteSelectorModal: (notes) => {
        return new Promise((resolve) => {
            const overlay = document.getElementById('editor-modal-overlay')
            const titleEl = document.getElementById('editor-modal-title')
            const fieldsContainer = document.getElementById('editor-modal-fields')
            const form = document.getElementById('editor-modal-form')
            const cancelBtn = document.getElementById('editor-modal-cancel')
            const submitBtn = document.getElementById('editor-modal-submit')

            if (!overlay || !fieldsContainer || !form) return resolve(null)

            // 1. Initialize view configuration parameters
            titleEl.textContent = "Open Note File"
            fieldsContainer.innerHTML = ''
            
            // Hide the main form confirm submit button since selections trigger instantly on click
            if (submitBtn) submitBtn.style.display = 'none'

            // 2. Structural list generation loop
            const listContainer = document.createElement('div')
            listContainer.className = 'modal-notes-list'

            if (!notes || notes.length === 0) {
                listContainer.innerHTML = `
                    <span class="modal-note-item" style="cursor: default; color: #8d8d99; justify-content: center;">
                        No notes currently saved in your workspace.
                    </span>`
            } else {
                notes.forEach(note => {
                    const modalListItem = document.createElement('div')
                    modalListItem.className = 'open-note-item'
                    
                    modalListItem.innerHTML = `
                        <span class="nav-item-icon"><svg><use href="#icon-note"/></svg></span>
                        <span class="nav-item-title">${note.title || 'Untitled Note'}</span>
                    `
                    
                    // 3. Capture instant click row transitions
                    modalListItem.addEventListener('click', (e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        closePipeline(note)
                    })

                    listContainer.appendChild(modalListItem)
                })
            }

            fieldsContainer.appendChild(listContainer)
            overlay.classList.remove('is-hidden')

            // 4. Unified closure and clean-up routine
            const closePipeline = (selectedNotePayload) => {
                overlay.classList.add('is-hidden')
                
                if (submitBtn) {
                    submitBtn.style.display = '' // Restore layout parameters
                    submitBtn.onclick = null     // Clear lingering event overrides
                }
                
                cancelBtn.onclick = null
                form.onsubmit = null
                
                resolve(selectedNotePayload)
            }

            cancelBtn.onclick = (e) => {
                e.preventDefault()
                closePipeline(null)
            }
            
            form.onsubmit = (e) => {
                e.preventDefault() // Trap unintentional enter key fires safely
            }
        })
    },

    // Compiles the raw CodeMirror text stream into a markdown file blob and downloads it
    exportToMarkdown: (noteTitle) => {
        if (!editorInstance) return

        // 1. Extract the raw text document from CodeMirror
        const markdownContent = editorInstance.state.doc.toString()

        // 2. Format a clean filename string
        const cleanTitle = (noteTitle || "Voltaira-Export").trim().replace(/[^a-z0-9]/gi, '_')
        const filename = `${cleanTitle}.md`

        // 3. Create a secure local file blob transmission channel
        const blob = new Blob([markdownContent], { type: "text/markdown;charset=utf-8;" })
        const url = URL.createObjectURL(blob)

        // 4. Trigger an invisible anchor element click to initiate download sequence
        const downloadAnchor = document.createElement("a")
        downloadAnchor.href = url
        downloadAnchor.download = filename
        downloadAnchor.click()

        // 5. Clean up the browser memory reference
        URL.revokeObjectURL(url)
    },

    // Targets the rendered markdown HTML preview layout panel and prints it to a downloadable PDF document
    // exportToPDF: (noteTitle, previewElementId = "note-preview-container") => {
    //     // Target the specific container where our compiled HTML output lives
    //     const targetPreviewDOM = document.getElementById(previewElementId)
        
    //     if (!targetPreviewDOM) {
    //         console.error(`PDF Export aborted: Layout node '#${previewElementId}' not found.`)
    //         return
    //     }

    //     const cleanTitle = (noteTitle || "Voltaira-Export").trim().replace(/[^a-z0-9]/gi, '_')
    //     const filename = `${cleanTitle}.pdf`

    //     // Configure high-fidelity compilation options for html2pdf
    //     const exportOptions = {
    //         margin:        0.75, // Adds margins matching standard printer paper rules
    //         filename:      filename,
    //         image:         { type: 'jpeg', quality: 0.98 },
    //         html2canvas:   { scale: 2, useCORS: true, logging: false }, // Scale 2 ensures crystal clear text rendering
    //         jsPDF:         { unit: 'in', format: 'letter', orientation: 'portrait' }
    //     }

    //     // Execute the asynchronous conversion stream
    //     html2pdf().set(exportOptions).from(targetPreviewDOM).save()
    // },

    exportToPDF: (noteTitle, previewElementId = "note-preview-container") => {
        // If you are using a different ID for your preview pane, pass it in here.
        // Based on standard layouts, we'll locate your markdown viewer surface.
        const targetPreviewDOM = document.getElementById(previewElementId);
        
        if (!targetPreviewDOM) {
            console.error(`PDF Export aborted: Layout node '#${previewElementId}' not found.`);
            return;
        }

        // 🎯 STEP 1: Set the saved file metadata name safely
        const cleanTitle = (noteTitle || "Voltaira-Export").trim();
        const originalTitle = document.title;
        document.title = cleanTitle;

        // 🎯 STEP 2: DYNAMIC TITLE INJECTION
        // Create a concrete layout heading for the native print subsystem to process
        const printTitleH1 = document.createElement('h1');
        printTitleH1.className = 'pdf-only-main-title';
        printTitleH1.textContent = cleanTitle;
        targetPreviewDOM.insertBefore(printTitleH1, targetPreviewDOM.firstChild);

        // 🎯 STEP 3: Inject the state flag to the root <body> to trigger clean CSS isolation
        document.body.classList.add('is-printing-pdf');

        // 🎯 STEP 4: Open the native browser print/save menu
        window.print();

        // 🎯 STEP 5: TEARDOWN CLEANUP
        document.body.classList.remove('is-printing-pdf');
        document.title = originalTitle;
        printTitleH1.remove(); // Instantly vanishes from the active screen view
    },

    // Initialize the Delete Account event listener
    initDeleteAccountListener: (onDeleteAccount) => {
        const deleteAccountBtn = document.getElementById('delete-account-btn')

        if (deleteAccountBtn) {
            deleteAccountBtn.addEventListener('click', async (e) => {
                // Prevent the click from bouncing around or triggering parent drop closures
                e.stopPropagation()
                await onDeleteAccount()
            })
        }
    },

    // Put page-specific events inside an initialize function
    init: async (onLogOutSuccess) => {
        // EditorView Logic

        // --- NOTE FIELDS -------------------
        const noteTitle = document.getElementById('note-title')
        const editorTarget = document.getElementById('note-editor-container')

        if(!editorTarget) return

        // Warm up the cache immediately on view initialization
        try {
            // Fetch notes and global tags from the database simultaneously
            const [notes, tags] = await Promise.all([
                noteService.getAllNotes(),
                tagService.getAllTags() 
            ])

            // Seed our module-scoped memory caches
            cachedNotes = notes
            cachedTags = tags
            
            // Populate the explorer immediately on app startup
            EditorView.renderExplorer()
            EditorView.renderExplorerFilters()
        } catch (err) {
            console.error("Failed to seed local notes cache:", err)
        }

        // Initialize CodeMirror instance
        editorInstance = new CodeMirror({
            parent: editorTarget,
            extensions: [
                basicSetup, // Includes line numbers, selection brackets, folding arrows
                markdown(), // Activates the Markdown text token parsing engine
                oneDark, // Matches your sleek application dark theme variables
                voltairaCanvasTheme, // Our custom theme
                syntaxHighlighting(voltairaMarkdownHighlight), // Our custom tags handling
                tableTabNavigationExtension, // Live table tab wrap navigation pipeline
                occurrenceHighlightField, // Highlighting extension
                noteNavigationClickExtension((targetNoteId) => {
                    console.log(`Navigation link fired! Routing workspace to target note: ${targetNoteId}`)
                    EditorView.loadNote(targetNoteId)
                }),
                
                CodeMirror.updateListener.of((update) => {
                    if (update.docChanged) {
                        const currentDoc = update.state.doc
                        const activeText = currentDoc.toString() // Capture the exact text stream

                        // 1. Instant real-time update of the tabs contents UI
                        EditorView.syncTableOfContents(update.state.doc)
                        EditorView.syncOutgoingLinks(currentDoc, cachedNotes)

                        // LIVE PREVIEW PIPELINE: Keep HTML panel hot if visible
                        if (isPreviewMode) {
                            EditorView.syncLivePreview(activeText)
                        }

                        // 2. --- AUTOSAVE SYSTEM ---
                        clearTimeout(saveTimer)
                        
                        saveTimer = setTimeout(async () => {
                            if (!currentNoteId) return
                            
                            const contentValue = update.state.doc.toString()
                            console.log("Autosaving CodeMirror buffer stream...")
                            
                            await noteService.updateNote(currentNoteId, {
                                title: noteTitle.value,
                                content: contentValue
                            })

                            // Update the Cache with whatever value is in the input field
                            EditorView.updateCachedTitle(currentNoteId, noteTitle.value)

                        }, 2000)
                    }
                })
            ]
        })

        // 2. Bind the scroll sync listeners to the fresh editor DOM engine
        EditorView.setupScrollSync()

        // --- AUTOSAVE TITLE FIELD ---
        noteTitle.addEventListener('input', () => {
            clearTimeout(saveTimer)
            saveTimer = setTimeout(async () => {
                if (!currentNoteId) return
                await noteService.updateNote(currentNoteId, {
                    title: noteTitle.value,
                    content: editorInstance.state.doc.toString()
                })
                // Update the Cache
                EditorView.updateCachedTitle(currentNoteId, noteTitle.value)
                
                // Refresh outgoing links on the spot to catch title text changes
                EditorView.syncOutgoingLinks(editorInstance.state.doc, cachedNotes)
            }, 2000)
        })


        // --- LOGOUT BUTTONS -----------------

        const logOutBtn = document.getElementById('logout-btn')
        const logoutBtnSplash = document.getElementById('splash-logout-btn')

        logOutBtn.addEventListener('click', () => logOutProcess())

        logoutBtnSplash.addEventListener('click', () => logOutProcess())

        // Logging out function
        async function logOutProcess () {
            try {
                const logout = await authService.logout()
                console.log("Logged out successfully")

                // If the logout succeeded, invoke the callback to refresh the application state
                onLogOutSuccess?.() // Optional Chaining (?.), replace an if statement
            } catch (error) {
                console.error("Logging out failed:", error.message)
                await EditorView.alertModal("Logging out failed.", 'error')
            }
        }


        // --- SPLASH PANEL -----------------

        // --- VARIABLES ---
        const splashCreate = document.getElementById('splash-create')
        const splashOpen = document.getElementById('splash-open')
        const splashBackBtn = document.getElementById('splash-picker-back')
        const splashNotesList = document.getElementById('splash-notes-list')
        const splashDefaultShell = document.getElementById('splash-default-options')
        const splashNotePickerShell = document.getElementById('splash-note-picker')


        // === OPTIONS ===
        // --- CREATE ---
        splashCreate.addEventListener('click', async () => {
            const newNote = await noteService.createNote()
            
            // Update the Cache
            cachedNotes.push(newNote)

            // Populates the explorer tab
            EditorView.renderExplorer()

            EditorView.loadNote(newNote._id)
        })

        // --- OPEN ---
        splashOpen.addEventListener('click', async () => {
            try {
                // 1. Fetch user records from the data layer repository
                const notes = await noteService.getAllNotes()

                // 2. Clear old menu data nodes
                splashNotesList.innerHTML = ''

                // 3. Render Empty State vs Population State
                if (notes.length === 0) {
                    splashNotesList.innerHTML = `<span class="splash-note-item" style="cursor: default; color: #8d8d99;">No notes found. Create one to get started!</span>`
                } else {
                    notes.forEach(note => {
                        const splashListItem = document.createElement('div')
                        splashListItem.className = 'splash-note-item'
                        splashListItem.innerHTML = `
                            <span class="nav-item-icon"><svg><use href="#icon-note"/></svg></span>
                            <span class="nav-item-title">${note.title || 'Untitled Note'}</span>
                        `

                        // 4. Attach routing activation pointer to click sequence
                        splashListItem.addEventListener('click', () => {
                            EditorView.loadNote(note._id)
                            // Switch back to the default splash shell
                            splashNotePickerShell.setAttribute('data-is-hidden', 'true')
                            splashDefaultShell.removeAttribute('data-is-hidden')
                        })

                        splashNotesList.appendChild(splashListItem)
                    })
                }

                // 5. Flip Layout States
                splashDefaultShell.setAttribute('data-is-hidden', 'true')
                splashNotePickerShell.removeAttribute('data-is-hidden')
            } catch (error) {
                console.error("Failed to render note-picker menu options:", error)
            }
        })

        // --- BACK ---
        splashBackBtn.addEventListener('click', () => {
            splashNotePickerShell.setAttribute('data-is-hidden', 'true')
            splashDefaultShell.removeAttribute('data-is-hidden')
        })


        // --- MAIN MENU --------------------

        // === MENU ===
        // --- VARIABLES ---
        // Main
        const fileBtn = document.getElementById('menu-file')
        const toolsBtn = document.getElementById('menu-tools')
        const settingsBtn = document.getElementById('menu-settings')
        const profileBtn = document.getElementById('menu-profile')
        // Submenu
        const fileMenu = document.getElementById('sub-file')
        const toolsMenu = document.getElementById('sub-tools')
        const settingsMenu = document.getElementById('sub-settings')
        const profileMenu = document.getElementById('profile-options')
        // Lists
        const menuList = [fileBtn, toolsBtn, settingsBtn]
        const submenuList = [fileMenu, toolsMenu, settingsMenu]

        // --- EVENT LISTENERS ---
        for (let i=0; i<menuList.length; i++) {
            menuList[i].addEventListener('mouseenter', () => {
                if (!submenuList[i].hasAttribute('data-is-visible')) {
                    submenuList.forEach(submenu => submenu.removeAttribute('data-is-visible'))
                    menuList.forEach(menu => menu.removeAttribute('data-is-selected'))
                    submenuList[i].toggleAttribute('data-is-visible')
                    menuList[i].toggleAttribute('data-is-selected')
                }
            })
        }

        // 1. Open cleanly when the cursor enters the Profile area
        profileBtn.addEventListener('mouseenter', () => {
            profileMenu.classList.add('is-open')
        })
        // 2. Hide it ONLY when the cursor completely leaves the entire button + menu area
        profileBtn.addEventListener('mouseleave', () => {
            profileMenu.classList.remove('is-open')
        })


        // === SUBMENU ===
        // --- VARIABLES ---
        // -- Module Options --
        // - FILE -
        // File
        const fileCreate = document.getElementById('file-create')
        const fileOpenFile = document.getElementById('file-open-file')
        const fileSave = document.getElementById('file-save')
        const fileExportMD = document.getElementById('file-export-md')
        const fileExportPDF = document.getElementById('file-export-pdf')
        // Edit
        const editUndo = document.getElementById('edit-undo')
        const editRedo = document.getElementById('edit-redo')
        const editCut = document.getElementById('edit-cut')
        const editCopy = document.getElementById('edit-copy')
        const editPaste = document.getElementById('edit-paste')
        // Selection
        const selectAll = document.getElementById('select-all')
        const selectOccurences = document.getElementById('select-occurences')
        const selectMoveUp = document.getElementById('select-move-up')
        const selectMoveDown = document.getElementById('select-move-down')
        // Info
        const infoCreate = document.getElementById('create-info')
        const infoOpen = document.getElementById('open-info')
        const infoSave = document.getElementById('save-info')
        const infoExport = document.getElementById('export-info')
        const infoRedo = document.getElementById('redo-info')
        const infoClipboard = document.getElementById('clipboard-info')
        const infoSelect = document.getElementById('select-info')
        const infoSearch = document.getElementById('search-info')
        const infoMove = document.getElementById('move-info')

        // - TOOLS -
        // Text
        const textBold = document.getElementById('style-bold')
        const textItalic = document.getElementById('style-italic')
        const textUnderline = document.getElementById('style-underline')
        const textStrike = document.getElementById('style-strike')
        const textSubscript = document.getElementById('effects-subscript')
        const textSuperscript = document.getElementById('effects-superscript')
        const textHeader = document.getElementById('format-header')
        const textHeaderOptions = document.getElementById('header-options')
        const textHeaderH1 = document.getElementById('header-h1')
        const textHeaderH2 = document.getElementById('header-h2')
        const textHeaderH3 = document.getElementById('header-h3')
        const textLink = document.getElementById('format-link')
        const textUList = document.getElementById('format-u-list')
        const textOList = document.getElementById('format-o-list')
        const textInlineCode = document.getElementById('format-inline-code')
        // Insert
        const insertTable = document.getElementById('insert-table')
        const insertPicture = document.getElementById('insert-picture')
        const insertCodeblock = document.getElementById('insert-codeblock')
        const insertQuote = document.getElementById('insert-quote')
        const insertDivider = document.getElementById('insert-divider')
        // Info
        const infoStyle = document.getElementById('style-info')
        const infoEffects = document.getElementById('effects-info')
        const infoFormat = document.getElementById('format-info')
        const infoInsert = document.getElementById('insert-info')

        // - SETTINGS -
        // View Buttons
        const viewMD = document.getElementById('settings-view-md')
        const viewSplit = document.getElementById('settings-view-split')
        const viewPreview = document.getElementById('settings-view-preview')
        // Info
        const infoView = document.getElementById('settings-view-info')
        // View containers
        const editorEl = document.getElementById('note-editor-container')
        const previewEl = document.getElementById('note-preview-container')

        // -- Lists --
        const optionsList = [fileCreate, fileOpenFile, fileSave, fileExportMD, fileExportPDF, editUndo, editRedo, editCut, editCopy,editPaste, selectAll, selectOccurences, selectMoveUp, selectMoveDown, textBold, textItalic, textUnderline, textStrike, textSubscript, textSuperscript, textHeader, textLink, textUList, textOList, textInlineCode, insertTable, insertPicture, insertCodeblock, insertQuote, insertDivider, viewMD, viewSplit, viewPreview]

        const infoList = [infoCreate, infoOpen, infoSave, infoExport, infoExport, infoRedo, infoRedo, infoClipboard, infoClipboard, infoClipboard, infoSelect, infoSearch, infoMove, infoMove, infoStyle, infoStyle, infoStyle, infoStyle, infoEffects, infoEffects, infoFormat, infoFormat, infoFormat, infoFormat, infoFormat, infoInsert, infoInsert, infoInsert, infoInsert, infoInsert, infoView, infoView, infoView]

        const messagesList = ['Create a new file', 'Open a file', 'Save your file', 'Export as .md', 'Export as .pdf', 'Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Select all', 'Find all', 'Move up', 'Move down', 'Bold', 'Italic', 'Underline', 'Strike', 'Subscript', 'Superscript', 'Header', 'Link', 'Unordered list', 'Ordered list', 'Inline code', 'Insert a table', 'Insert a picture', 'Insert codeblock', 'Insert a quote', 'Insert divider', 'Markdown-only', 'Split view', 'Preview']


        // --- EVENT LISTENERS ---
        // Loop through optionsList to create the EventListeners
        for (let i=0; i<optionsList.length; i++) {
            optionsList[i].addEventListener('mouseenter', () => showOptionInfo(infoList[i], messagesList[i]))
            optionsList[i].addEventListener('mouseleave', () => clearOptionInfo(infoList[i], messagesList[i]))
        }

        // Helper functions
        function showOptionInfo(optionInfo, text) {
            optionInfo.innerText = text
            optionInfo.toggleAttribute('data-is-visible')
        }

        function clearOptionInfo(optionInfo) {
            optionInfo.toggleAttribute('data-is-visible')
        }


        // === BUTTONS LOGIC ===

        // --- SAVE BUTTON ---
        fileSave.addEventListener('click', async () => {
            const title = noteTitle.value
            const content = noteContent.value
            const tags = []
            const links = []

            const updates = {
                title: title,
                content: content,
                tags: tags,
                links: links
            }

            try {
                await noteService.updateNote(currentNoteId, updates)
                console.log("Saved successfully!")
            } catch (err) {
                console.error("Save failed", err)
                await EditorView.alertModal("It seems like we couldn't save your file.", 'error')
            }
        })

        // --- CREATE BUTTON ---
        fileCreate.addEventListener('click', async () => {
            try {
                // Spin up standard document via our service layer data manager
                const newNote = await noteService.createNote()

                // Seed our frontend store
                cachedNotes.push(newNote)

                // Re-render navigation panels and focus workspace
                EditorView.renderExplorer()
                EditorView.loadNote(newNote._id)
                console.log("Global workspace generation pipeline fired successfully!")
            } catch (err) {
                console.error("Global toolbar creation event crashed:", err)
            }
        })

        // --- OPEN FILE BUTTON ---
        fileOpenFile.addEventListener('click', async () => {
            const userNotes = await noteService.getAllNotes()
            // Launch the selector panel with context data and pause execution
            const chosenNote = await EditorView.promptNoteSelectorModal(userNotes)
            // If the user picked a valid file, feed the structural entity down to your main note loader
            if (chosenNote) {
                EditorView.loadNote(chosenNote._id)
            }
        })

        // --- OTHER FILE BUTTONS ---
        // Export
        fileExportMD.addEventListener('click', () => EditorView.exportToMarkdown(noteTitle.value))
        fileExportPDF.addEventListener('click', () => EditorView.exportToPDF(noteTitle.value, 'note-preview-container'))
        // Edit
        editUndo.addEventListener('click', () => EditorView.executeHistoryAction('undo'))
        editRedo.addEventListener('click', () => EditorView.executeHistoryAction('redo'))
        editCut.addEventListener('click', () => EditorView.executeClipboardAction('cut'))
        editCopy.addEventListener('click', () => EditorView.executeClipboardAction('copy'))
        editPaste.addEventListener('click', () => EditorView.executeClipboardAction('paste'))
        // Selection
        selectAll.addEventListener('click', () => EditorView.selectAllText())
        selectOccurences.addEventListener('click', () => EditorView.highlightOccurrences())
        selectMoveUp.addEventListener('click', () => EditorView.moveLines('up'))
        selectMoveDown.addEventListener('click', () => EditorView.moveLines('down'))

        // --- TOOLS BUTTONS ---
        // Text
        textBold.addEventListener('click', () => EditorView.applyTextFormat('bold'))
        textItalic.addEventListener('click', () => EditorView.applyTextFormat('italic'))
        textUnderline.addEventListener('click', () => EditorView.applyTextFormat('underline'))
        textStrike.addEventListener('click', () => EditorView.applyTextFormat('strikethrough'))
        textSubscript.addEventListener('click', () => EditorView.applyTextFormat('subscript'))
        textSuperscript.addEventListener('click', () => EditorView.applyTextFormat('superscript'))
        /* headers */
        /* To close header submenu when click outside of it */
        const closeHeaderPopup = (e) => {
            if (!textHeaderOptions.contains(e.target) && !textHeader.contains(e.target)) {
                textHeaderOptions.classList.remove('is-open')
                document.removeEventListener('click', closeHeaderPopup)
            }
        }
        textHeader.addEventListener('click', (e) => {
            e.stopPropagation()

            const isOpen = textHeaderOptions.classList.toggle('is-open')

            if (isOpen) {
                document.addEventListener('click', closeHeaderPopup)
            } else {
                document.removeEventListener('click', closeHeaderPopup)
            }
        })
        textHeaderH1.addEventListener('click', () => EditorView.toggleLineFormat('h1'))
        textHeaderH2.addEventListener('click', () => EditorView.toggleLineFormat('h2'))
        textHeaderH3.addEventListener('click', () => EditorView.toggleLineFormat('h3'))
        // Continue with Text
        textLink.addEventListener('click', async () => {
            const userNotes = await noteService.getAllNotes()
            EditorView.insertLink(userNotes)
        })
        textUList.addEventListener('click', () => EditorView.toggleLineFormat('ul'))
        textOList.addEventListener('click', () => EditorView.toggleLineFormat('ol'))
        textInlineCode.addEventListener('click', () => EditorView.applyTextFormat('code'))
        // Insert
        insertTable.addEventListener('click', () => EditorView.insertStructure('table'))
        insertPicture.addEventListener('click', () => EditorView.insertStructure('picture'))
        insertCodeblock.addEventListener('click', () => EditorView.insertStructure('codeblock'))
        insertQuote.addEventListener('click', () => EditorView.insertStructure('quote'))
        insertDivider.addEventListener('click', () => EditorView.insertStructure('divider'))

        // --- VIEWS OPTIONS ---
        // MD only
        viewMD.addEventListener('click', () => {
            EditorView.toggleViewMode("mdOnly")
        })

        // Split view
        viewSplit.addEventListener('click', () => {
            EditorView.toggleViewMode("splitView")
        })

        // Live preview
        viewPreview.addEventListener('click', () => {
            EditorView.toggleViewMode("livePreview")
        })

        // --- LIGHT/DARK MODE ---
        const modeToggle = document.getElementById('mode-toggle')

        const savedMode = localStorage.getItem('site-mode') || 'light'
        modeToggle.checked = savedMode === 'dark'
        document.documentElement.setAttribute('data-mode', savedMode)

        modeToggle.addEventListener('change', () => {
            const mode = modeToggle.checked ? 'dark' : 'light'
            document.documentElement.setAttribute('data-mode', mode)
            localStorage.setItem('site-mode', mode)
        })


        // --- THEMES ---
        const options = document.querySelectorAll('.theme-option')

        // On page load, restore the saved theme
        // localStorage persists data across page reloads.
        // We fall back to 'default' if nothing is saved yet.
        let savedTheme = localStorage.getItem('site-theme') || 'default'
        applyTheme(savedTheme, true)

        // -- Hover preview + click to save -- 
        // Loop over every theme option and attach events.
        options.forEach((option) => {
            const theme = option.dataset.theme // read the data-theme="..." attribute

            // - Preview on hover -
            // mouseenter fires when the cursor enters the element
            option.addEventListener('mouseenter', () => {
                applyTheme(theme, false) // false = don't update the checkmark yet
            })

            // mouseleave fires when the cursor leaves the element
            option.addEventListener('mouseleave', () => {
                applyTheme(savedTheme, false) // revert to whatever was last saved
            })

            // - Save on click -
            option.addEventListener('click', () => {
                savedTheme = theme
                localStorage.setItem('site-theme', theme) // persist to localStorage
                applyTheme(theme, true)
                // location.reload() // re-run the page so the saved theme loads cleanly
            })
        })

        // Helper function — applyTheme(theme, updateActive)
        // theme        : string, e.g. 'ocean'
        // updateActive : boolean — whether to move the checkmark
        function applyTheme (theme, updateActive) {
            // Swap the data-theme attribute on <html>.
            document.documentElement.setAttribute('data-theme', theme)

            // Optionally move the .active class (checkmark) to the chosen option
            if (updateActive) {
                options.forEach((opt) => {
                    opt.classList.toggle('active', opt.dataset.theme === theme)
                })
            }
        }
        

        // --- SIDE MENU ---------------------------

        // --- VARIABLES ---
        // Tabs
        const explorerTab = document.getElementById('tab-explorer')
        const tocTab = document.getElementById('tab-toc')
        const linksTab = document.getElementById('tab-links')
        const tagsTab = document.getElementById('tab-tags')
        const mdTab = document.getElementById('tab-md')
        const aboutTab = document.getElementById('tab-about')
        const tabsList = [explorerTab, tocTab, linksTab, tagsTab, mdTab, aboutTab]

        // Tooltips
        const explorerTooltip = document.getElementById('tooltip-explorer')
        const tocTooltip = document.getElementById('tooltip-toc')
        const linksTooltip = document.getElementById('tooltip-links')
        const tagsTooltip = document.getElementById('tooltip-tags')
        const mdTooltip = document.getElementById('tooltip-md')
        const aboutTooltip = document.getElementById('tooltip-about')
        const tooltipsList = [explorerTooltip, tocTooltip, linksTooltip, tagsTooltip, mdTooltip, aboutTooltip]

        // Tab Display
        const tabsDisplay = document.getElementById('tabs-display')
        const tabWrapperExplorer = document.getElementById('explorer-wrapper')
        const tabWrapperToc = document.getElementById('toc-wrapper')
        const tabWrapperLinks = document.getElementById('links-wrapper')
        const tabWrapperTags = document.getElementById('tags-wrapper')
        const tabWrapperMD = document.getElementById('md-wrapper')
        const tabWrapperAbout = document.getElementById('about-wrapper')
        const tabNamesList = ['explorer', 'toc', 'links', 'tags', 'md', 'about']
        const tabWrappersList = [tabWrapperExplorer, tabWrapperToc, tabWrapperLinks, tabWrapperTags, tabWrapperMD, tabWrapperAbout]

        for (let i=0; i<tabsList.length; i++) {
            // --- TOOLTIPS ---
            tabsList[i].addEventListener('mouseenter', () => {
                tooltipsList[i].toggleAttribute('data-is-visible')
            })
            tabsList[i].addEventListener('mouseleave', () => {
                tooltipsList[i].toggleAttribute('data-is-visible')
            })

            // --- TABS DISPLAY EXPANSION ---
            tabsList[i].addEventListener('click', () => {
                if (tabsDisplay.hasAttribute('data-is-visible')) {
                    if (tabsDisplay.getAttribute('data-tab-showing') === tabNamesList[i]) {
                        // Same tab so we close the tab display
                        clearTabDisplay()
                        tabsList[i].classList.remove('tab-active')
                        tabsDisplay.toggleAttribute('data-is-visible')
                    } else {
                        // Switch the active tab
                        tabsList.forEach(tab => tab.classList.remove('tab-active'))
                        tabsList[i].classList.add('tab-active')
                        // Display new tab content
                        tabsDisplay.setAttribute('data-tab-showing', tabNamesList[i])
                        switchTabDisplay(tabNamesList[i])
                    }
                } else {
                    tabsList[i].classList.add('tab-active')
                    tabsDisplay.setAttribute('data-tab-showing', tabNamesList[i])
                    tabsDisplay.toggleAttribute('data-is-visible')
                    switchTabDisplay(tabNamesList[i])
                }
            })
        }

        function clearTabDisplay() {
            tabWrappersList.forEach(tab => {
                tab.setAttribute('data-is-hidden', 'true')
            })
        }

        function switchTabDisplay(tabName) {
            // Hide all tabs
            clearTabDisplay()

            // Show the proper one
            switch (tabName) {
                case 'explorer':
                    tabWrapperExplorer.removeAttribute('data-is-hidden')
                    EditorView.renderExplorerFilters()
                    EditorView.renderExplorer()
                    break
                case 'toc':
                    tabWrapperToc.removeAttribute('data-is-hidden')
                    break
                case 'links':
                    tabWrapperLinks.removeAttribute('data-is-hidden')
                    break
                case 'tags':
                    tabWrapperTags.removeAttribute('data-is-hidden')
                    break
                case 'md':
                    tabWrapperMD.removeAttribute('data-is-hidden')
                    break
                case 'about':
                    tabWrapperAbout.removeAttribute('data-is-hidden')
                    break
            }
        }

        // --- TABS LOGIC ---

        // === TAG CREATION ===
        const submitTagBtn = document.getElementById('submit-new-tag-btn')
        const newTagNameInput = document.getElementById('new-tag-name-input')
        const newTagColorInput = document.getElementById('new-tag-color-input')

        submitTagBtn?.addEventListener('click', async () => {
            const rawName = newTagNameInput.value.trim()
            const selectedColor = newTagColorInput.value

            if (!rawName) return

            try {
                // 1. Save new configuration directly into the global collection database
                const newTag = await tagService.createTag({ name: rawName, color: selectedColor })

                // 2. Hydrate frontend cache definitions
                cachedTags.push(newTag)

                // 3. Clear text input fields
                newTagNameInput.value = ''

                // 4. Update both layout sidebars simultaneously
                EditorView.renderExplorerFilters()
                EditorView.renderTagInspector()

            } catch (err) {
                console.error("Failed to construct tag metadata schema:", err)
            }
        })
    }
}

