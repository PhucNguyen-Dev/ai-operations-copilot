import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

it('writes e2e results only to the gitignored JSON path', () => {
  const source = readFileSync(new URL('../../scripts/e2e-tests.mjs', import.meta.url), 'utf8')
  const writer = source.slice(source.indexOf('const pass = results.filter'))
  const mkdirSync = vi.fn()
  const writeFileSync = vi.fn()
  const exit = vi.fn()
  const results = [{ name: 'local fixture', pass: true, detail: 'passed' }]
  runInNewContext(writer, { results, mkdirSync, writeFileSync, console: { log: vi.fn() }, process: { exit } })
  expect(mkdirSync).toHaveBeenCalledExactlyOnceWith('test-results', { recursive: true })
  expect(writeFileSync).toHaveBeenCalledTimes(1)
  expect(writeFileSync.mock.calls[0][0]).toBe('test-results/e2e-results.json')
  expect(JSON.parse(writeFileSync.mock.calls[0][1])).toEqual({ run: expect.any(String), passed: 1, total: 1, results })
  expect(exit).toHaveBeenCalledWith(0)
  expect(readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8')).toContain('test-results/')
})
