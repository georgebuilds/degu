/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
}))

vi.mock('preact', () => ({
  render: mocks.render,
}))

// The entry imports './index.css' (handled by vite) and the App component.
vi.mock('./app.tsx', () => ({
  App: () => null,
}))

afterEach(() => {
  vi.resetModules()
  mocks.render.mockClear()
  document.body.innerHTML = ''
})

describe('main entry', () => {
  it('mounts the App into #app', async () => {
    const mount = document.createElement('div')
    mount.id = 'app'
    document.body.appendChild(mount)

    await import('./main.tsx')

    expect(mocks.render).toHaveBeenCalledTimes(1)
    const [, container] = mocks.render.mock.calls[0]
    expect(container).toBe(mount)
  })
})
