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
            const response = await fetch(`${BASE_API_URL}/users/me`, fetchConfig('DELETE'))

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