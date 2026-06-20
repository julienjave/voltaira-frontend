import { defineConfig } from 'vite';

export default defineConfig({
  base: '/voltaira-frontend/',
  server: {
    port: 5173,
    proxy: {
      // Catch every single API call and seamlessly pass it to Express
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Removes the '/api' prefix before sending it to your backend
        // so '/api/auth/register' becomes 'http://localhost:3000/auth/register'
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})