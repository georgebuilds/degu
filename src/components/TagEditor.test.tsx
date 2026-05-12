/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TagEditor } from './TagEditor.tsx'

afterEach(() => {
  cleanup()
})

describe('TagEditor', () => {
  it('renders an input with placeholder "Add tags…"', () => {
    render(<TagEditor tags={[]} onChange={vi.fn()} />)
    expect(screen.getByPlaceholderText('Add tags…')).toBeTruthy()
  })

  it('typing "foo" and pressing Enter calls onChange with ["foo"]', () => {
    const onChange = vi.fn()
    render(<TagEditor tags={[]} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Add tags…')
    fireEvent.input(input, { target: { value: 'foo' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['foo'])
  })

  it('typing "bar," (with comma) calls onChange with ["bar"]', () => {
    const onChange = vi.fn()
    render(<TagEditor tags={[]} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Add tags…')
    fireEvent.input(input, { target: { value: 'bar' } })
    fireEvent.keyDown(input, { key: ',' })
    expect(onChange).toHaveBeenCalledWith(['bar'])
  })

  it('blurring input with non-empty draft commits via onChange', async () => {
    const onChange = vi.fn()
    render(<TagEditor tags={[]} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Add tags…')
    fireEvent.input(input, { target: { value: 'blurtag' } })
    fireEvent.blur(input)
    // Blur commit is deferred via queueMicrotask to let a datalist click
    // settle its value into the input first; flush microtasks before asserting.
    await Promise.resolve()
    expect(onChange).toHaveBeenCalledWith(['blurtag'])
  })

  it('does not call onChange when blurring with empty draft', async () => {
    const onChange = vi.fn()
    render(<TagEditor tags={[]} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Add tags…')
    fireEvent.blur(input)
    await Promise.resolve()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('autoFocus={true} puts focus on the input on mount', () => {
    render(<TagEditor tags={[]} onChange={vi.fn()} autoFocus={true} />)
    const input = screen.getByPlaceholderText('Add tags…')
    expect(document.activeElement).toBe(input)
  })

  it('datalist contains only suggestion tags not already in tags', () => {
    render(
      <TagEditor
        tags={['alpha']}
        onChange={vi.fn()}
        suggestionTags={['alpha', 'beta']}
      />
    )
    // 'beta' should be in the datalist, 'alpha' should not (already a tag)
    const options = document.querySelectorAll('datalist option')
    const values = Array.from(options).map(o => (o as HTMLOptionElement).value)
    expect(values).toContain('beta')
    expect(values).not.toContain('alpha')
  })

  it('no datalist is rendered when suggestionTags is empty', () => {
    render(
      <TagEditor tags={[]} onChange={vi.fn()} suggestionTags={[]} />
    )
    expect(document.querySelector('datalist')).toBeNull()
  })

  it('appends new tags to existing tags without duplicates', () => {
    const onChange = vi.fn()
    render(<TagEditor tags={['existing']} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Add tags…')
    fireEvent.input(input, { target: { value: 'newtag' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['existing', 'newtag'])
  })

  it('does not add duplicate tags', () => {
    const onChange = vi.fn()
    render(<TagEditor tags={['foo']} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Add tags…')
    fireEvent.input(input, { target: { value: 'foo' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // onChange should not be called because no new tag would be added
    // Actually commit() calls onChange with the same array if no new tags added
    // Looking at the implementation: parts = ['foo'], next = [...tags] = ['foo'],
    // since 'foo' is already in next it won't be pushed — but onChange is still called
    // with the existing array. Let's just verify onChange is called with ['foo'] (no dupe).
    expect(onChange).toHaveBeenCalledWith(['foo'])
  })

  it('splits comma-separated input into multiple tags', () => {
    const onChange = vi.fn()
    render(<TagEditor tags={[]} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Add tags…')
    // Type "one,two" and press Enter — the commit splits on commas
    fireEvent.input(input, { target: { value: 'one,two' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['one', 'two'])
  })
})
