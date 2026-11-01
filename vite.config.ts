import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      'lucide-react': path.resolve(__dirname, './src/utils/lucideShim.tsx'),
      'jszip': path.resolve(__dirname, './src/utils/jszipShim.ts')
    }
  },
  server: {
    port: 5173,
    host: true
  }
})
