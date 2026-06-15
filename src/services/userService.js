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

export const userService = {

    // Delete User Account
    deleteUserAccount: async () => {
        try {
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/users/me`, fetchConfig('DELETE'))

            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}))
                throw new Error(errorBody.message || `HTTP Error: ${response.status}`)
            }

            const data = await response.json()

            return {
                success: true,
                message: data.message || "Account successfully deleted."
            }
        } catch (error) {
            console.error('API Error inside userService.deleteUserAccount:', error.message)
            throw error // Re-throw so our UI component can catch it and show an error message
        }
    }
}