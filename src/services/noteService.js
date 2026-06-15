// --- HELPER FUNCTION ---------------------------------------------------------------------------------------

// Reusable configuration options to keep code DRY (Don't Repeat Yourself)
const fetchConfig = (method, bodyData = null) => {
    const config = {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
    }

    if (bodyData) {
        config.body = JSON.stringify(bodyData)
    }

    return config
}


// --- SERVICE ------------------------------------------------------------------------------------------------

export const noteService = {
    getAllNotes: async () => {
        try {
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/notes`, fetchConfig('GET'))
            if (!response.ok) {
                throw new Error('Failed to retrieve notes.')
            }
            return await response.json()
        } catch (error) {
            console.error('Error inside getAllNotes:', error)
            throw error
        }
    },

    getNoteById: async (id) => {
        try {
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/notes/${id}`, fetchConfig('GET'))
            if (!response.ok) throw new Error('Failed to retrieve the note.')
            return await response.json()
        } catch (error) {
            console.error(`Error inside getNoteById (${id}):`, error)
            throw error
        }
    },

    getNotesByTags: async (tagIds) => {
    try {
        // Directly join the IDs: '60d5ec...,60d5ed...'
        const tagsQueryParam = tagIds.join(',')
        const url = `/notes/filter/bytags?tags=${tagsQueryParam}`

        const response = await fetch(`${import.meta.env.VITE_BASE_URL}${url}`, fetchConfig('GET'))

        if (!response.ok) throw new Error('Failed to filter notes')
        return await response.json()
    } catch (error) {
        console.error(error)
        throw error
    }
},

    createNote: async (title = 'Untitled', content = '', tags = [], links = []) => {
        try {
            const payload = { 
                title: title, 
                content: content, 
                tags: tags, 
                links: links 
            }
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/notes`, fetchConfig('POST', payload))
            if (!response.ok) throw new Error('Failed to generate a new note.')
            return await response.json() // Returns the newly made note document containing its ID
        } catch (error) {
            console.error('Error inside createNote:', error)
            throw error
        }
    },

    updateNote: async (id, updates) => {
        try {
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/notes/${id}`, fetchConfig('PATCH', updates))
            if (!response.ok) throw new Error('Failed to synchronize note changes.')
            return await response.json()
        } catch (error) {
            console.error(`Error inside updateNote (${id}):`, error)
            throw error
        }
    },

    addTagToNote: async (noteId, tagId) => {
        const response = await fetch(`${import.meta.env.VITE_BASE_URL}/notes/${noteId}/tags/${tagId}/add`, fetchConfig('PATCH'))
        if (!response.ok) throw new Error('Failed to attach tag')
        return await response.json() // Returns the updated note object
    },

    removeTagFromNote: async (noteId, tagId) => {
        const response = await fetch(`${import.meta.env.VITE_BASE_URL}/notes/${noteId}/tags/${tagId}/remove`, fetchConfig('PATCH'))
        if (!response.ok) throw new Error('Failed to sever tag connection')
        return await response.json() // Returns the updated note object
    },

    deleteNote: async (id) => {
        try {
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/notes/${id}`, fetchConfig('DELETE'))
            if (!response.ok) throw new Error('Failed to execute document deletion.')
            return await response.json()
        } catch (error) {
            console.error(`Error inside deleteNote (${id}):`, error)
            throw error
        }
    }
}