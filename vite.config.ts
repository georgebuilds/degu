/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import tailwindcss from '@tailwindcss/vite'
import { readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const COI_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

const stripOrphanWorkers = (): Plugin => ({
  name: 'degu:strip-orphan-workers',
  apply: 'build',
  closeBundle() {
    const outDir = join(process.cwd(), 'dist')
    for (const name of readdirSync(outDir)) {
      if (/^worker-.*\.js$/.test(name)) unlinkSync(join(outDir, name))
    }
    const remaining = readdirSync(outDir)
    const allowed = new Set(['index.html', '.vite'])
    const stray = remaining.filter((n) => !allowed.has(n))
    if (stray.length > 0) {
      throw new Error(
        `singlefile contract violated: dist/ contains unexpected entries: ${stray.join(', ')}`,
      )
    }
    if (!remaining.includes('index.html')) {
      throw new Error('singlefile contract violated: dist/index.html is missing')
    }
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact(), tailwindcss(), viteSingleFile(), stripOrphanWorkers()],
  server: {
    headers: COI_HEADERS,
  },
  preview: {
    headers: COI_HEADERS,
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      // lcov feeds the Codecov upload in CI; text prints a local summary.
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
    },
  },
})
