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

export const tagService = {
    getAllTags: async () => {
        try {
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/tags`, fetchConfig('GET'))

            if (!response.ok) {
                throw new Error('Failed to fetch the global tag library')
            }

            return await response.json()
        } catch (error) {
            console.error("tagService.getAllTags error:", error)
            throw error
        }
    },

    createTag: async (tagData) => {
        try {
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/tags`, fetchConfig('POST', tagData))

            if (!response.ok) {
                const errorData = await response.json()
                // This catches schema errors like missing fields or duplicate names
                throw new Error(errorData.message || 'Failed to create new tag resource')
            }

            return await response.json()
        } catch (error) {
            console.error("tagService.createTag error:", error)
            throw error
        }
    },

    updateTag: async (tagId, tagData) => {
        try {
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/tags/${tagId}`, fetchConfig('PATCH', tagData))

            if (!response.ok) {
                const errorData = await response.json()
                throw new Error(errorData.message || 'Failed to modify tag meta definitions')
            }

            return await response.json()
        } catch (error) {
            console.error(`tagService.updateTag error for ID ${tagId}:`, error)
            throw error
        }
    },

    deleteTagById: async (tagId) => {
        try {
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/tags/${tagId}`, fetchConfig('DELETE'))

            if (!response.ok) {
                throw new Error('Failed to purge tag from system database')
            }

            return await response.json() // Returns { message: "Tag deleted successfully" }
        } catch (error) {
            console.error(`tagService.deleteTagById error for ID ${tagId}:`, error)
            throw error
        }
    }
}