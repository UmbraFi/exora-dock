import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    strictPort: true,
    watch: {
      ignored: [
        '**/release/**',
        '**/binaries/**',
        '**/coverage/**',
        '**/button-visual-fixture.html',
      ],
    },
  },
})
