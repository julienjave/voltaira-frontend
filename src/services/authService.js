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



const BASE_API_URL = import.meta.env.VITE_BASE_URL || 'https://voltaira-backend.onrender.com'

export const authService = {

    // --- REGISTER ---
    register: async (username, email, password) => {
        try {
            const response = await fetch(`${BASE_API_URL}/auth/register`, {
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
            const response = await fetch(`${BASE_API_URL}/auth/login`, {
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
            const response = await fetch(`${BASE_API_URL}/auth/logout`, {
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