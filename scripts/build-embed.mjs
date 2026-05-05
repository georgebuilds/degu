#!/usr/bin/env node
// Stage the Vite single-file bundle into the Go embed directory.
//
// Wails' `frontend:build` doesn't pass through a shell, so chained commands
// (`npm run build && cp …`) get mangled — extra args land on the final
// program. This script wraps the two steps so Wails (and the Makefile, and
// CI) can call a single executable.

import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist/index.html')
const target = resolve(root, 'internal/server/static/index.html')

execSync('npm run build', { stdio: 'inherit', cwd: root })

mkdirSync(dirname(target), { recursive: true })
copyFileSync(dist, target)

console.log(`embed: staged ${dist} → ${target}`)
