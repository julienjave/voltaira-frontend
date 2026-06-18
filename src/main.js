// Style
import './style/main.scss'

// Views
import { AuthView } from './views/authView'
import { EditorView } from './views/editorView'

// Services
import { userService } from './services/userService'


// Define app
const appContainer = document.getElementById('app')

// Simple global state machine object
const appState = {
    isAuthenticated: false,
    user: null
}


// --- AUTH FUNCTIONS ----------------------------------------------------------------

const onAuthSuccess = () => {
    console.log('Athentication event detected')

    // Update global application permissions state flags
    appState.isAuthenticated = true

    // Re-evaluate the router system to cleanly paint the next view screen
    router()
}

const onLogoutSuccess = () => {
    console.log('Logout event detected')
    appState.isAuthenticated = false
    appState.user = null
    router() 
}


// --- ACCOUNT DELETION --------------------------------------------------------------

// Orchestrates the secure account deletion confirmation flow and structural state cleanup
async function handleDeleteAccount() {
    try {
        // 1. Define the custom confirmation field schema for our engine
        const modalFields = [
            {
                key: 'verification',
                label: "This action is permanent and will completely erase your notes and tags. To proceed, please type 'DELETE' in the field below:",
                type: 'text',
                placeholder: 'DELETE',
                required: true,
                defaultValue: ''
            }
        ]

        // 2. Open our custom modal and await the user input promise sequence
        const modalResult = await EditorView.promptCustomModal(
            "⚠️ Permanently Delete Account?", 
            modalFields
        )

        // Case A: The user hit cancel (resolves as null) -> abort execution
        if (!modalResult) {
            console.log("Account deletion aborted by user.")
            return
        }

        // Case B: The user typed something else -> guard against accident or typos
        if (modalResult.verification !== 'DELETE') {
            await EditorView.alertModal("Verification failed. You must type 'DELETE' exactly to confirm.", 'error')
            return
        }

        // 3. User validated the request -> Dispatch the fetch call to the server controller
        console.log("Initiating server account purge sequence...")
        const result = await userService.deleteUserAccount()

        if (result.success) {
            await EditorView.alertModal(result.message || "Your account has been deleted.", 'success')
            
            // Trigger our built-in SPA state-wipe and route transition
            onLogoutSuccess()
        }

    } catch (error) {
        console.error("Failed to execute account deletion sequence:", error.message)
        await EditorView.alertModal(`Deletion Error: ${error.message}`, 'error')
    }
}


// --- CLIENT-SIDE ROUTER ------------------------------------------------------------

const router = async () => {
    appContainer.innerHTML = ''

    // Check if an active session cookie already exists on the backend server
    if (!appState.isAuthenticated) {
        try {
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/auth/status`, {credentials: 'include'})
    
            if (response.ok) {
                const data = await response.json()
                appState.isAuthenticated = true
                appState.user = data.user
            } else {
                appState.isAuthenticated = false
            }
        } catch (error) {
            appState.isAuthenticated = false // Fallback to login container if network drops
        }
    }

    if (!appState.isAuthenticated) {
        // 1. Inject the HTML template string
        appContainer.innerHTML = AuthView.render()
        // 2. Bind the event listeners to the newly created DOM elements
        AuthView.init(onAuthSuccess)
    } else {
        // 1. Inject the HTML template string
        appContainer.innerHTML = EditorView.render()
        // 2. Bind the event listeners to the newly created DOM elements
        EditorView.init(onLogoutSuccess)
        EditorView.initDeleteAccountListener(handleDeleteAccount)
    }
}

// Fire router when the DOM contents load
window.addEventListener('DOMContentLoaded', router)
