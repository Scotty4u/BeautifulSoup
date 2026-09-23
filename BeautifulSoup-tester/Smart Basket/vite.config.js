import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // This catches any React fetch('/api/...') and sends it to Flask
      '/api': {
        target: 'http://127.0.0.1:5000', 
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
