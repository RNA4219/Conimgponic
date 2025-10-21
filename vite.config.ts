import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: false, open: false, strictPort: true, cors: false },
  preview:{ host: false, open: false, strictPort: true, cors: false }
})
