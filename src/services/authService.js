export const authService = {

    // --- REGISTER ---
    register: async (username, email, password) => {
        try {
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/auth/register`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    email: email,
                    password: password
                })
            })
            
            // Handle server-side errors
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.message || 'Registration operational failure')
            }
            
            const registration = await response.json()
            return registration
        } catch (error) {
            console.error('API Error inside authService.register:', error.message)
            throw error // Re-throw so our UI component can catch it and show an error message
        }
    },

    // --- LOGIN ---
    login: async (username, password) => {
        try {
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/auth/login`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    password: password
                })
            })

            const login = await response.json()
            return login
        } catch (error) {
            console.error('API Error inside authService.login:', error.message)
            throw error
        }
    },
    
    // --- LOGOUT ---
    logout: async () => {
        try {
            const response = await fetch(`${import.meta.env.VITE_BASE_URL}/auth/logout`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            })

            // Handle server-side errors
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.message || 'Logout operational failure')
            }

            const logout = await response.json()
            return logout
                
        } catch (error) {
            console.error('API Error inside authService.logout:', error.message)
            throw error
        }
    }
}