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


// Login or Register page

import { authService } from "../services/authService"

import htmlTemplate from "../templates/authTemplate.html?raw"

export const AuthView = {
    render: () => {
        return htmlTemplate
    },

    // Put page-specific events inside an initialize function
    init: (onAuthSuccess) => {
        // Login Form Logic
        const formLogin = document.getElementById('login-form')
        formLogin.addEventListener('submit', async (e) => {
            e.preventDefault()
            console.log('Login form submitted!')
            
            const username = document.getElementById('login-username').value
            const password = document.getElementById('login-password').value

            try {
                const login = await authService.login(username, password)

                onAuthSuccess?.()
            } catch (error) {
                console.error("Login failed:", error.message)
            }
        })

        // Register Form Logic
        const formRegister = document.getElementById('register-form')
        formRegister.addEventListener('submit', async (e) => {
            e.preventDefault()
            
            const username = document.getElementById('register-username').value
            const email = document.getElementById('register-email').value
            const password = document.getElementById('register-password').value

            try {
                const registration = await authService.register(username, email, password)
                console.log("Account created & logged in automatically:", registration)

                // Route user forward to their dashboard workspace
                onAuthSuccess?.()
            } catch (error) {
                // Handle the error
                console.error("Registration failed:", error.message)
            }
        })
    }
}