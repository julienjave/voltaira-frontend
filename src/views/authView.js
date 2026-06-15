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