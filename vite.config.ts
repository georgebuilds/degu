/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import tailwindcss from '@tailwindcss/vite'
import { readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const stripOrphanWorkers = (): Plugin => ({
  name: 'degu:strip-orphan-workers',
  apply: 'build',
  closeBundle() {
    const outDir = join(process.cwd(), 'dist')
    for (const name of readdirSync(outDir)) {
      if (/^worker-.*\.js$/.test(name)) unlinkSync(join(outDir, name))
    }
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact(), tailwindcss(), viteSingleFile(), stripOrphanWorkers()],
  build: {
    target: 'esnext',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
