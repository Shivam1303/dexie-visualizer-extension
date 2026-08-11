import { describe, expect, it } from 'vitest'
// @ts-expect-error `@types/node` is not a dependency of this project; these tests
// run in vitest's node environment, so the builtin resolves at runtime. Importing
// `styles.css?raw` is not an option: the crx plugin stubs CSS to '' under vitest.
import { readFileSync } from 'node:fs'

const cssPath = new URL('../src/panel/styles.css', import.meta.url).pathname
const css = (readFileSync(cssPath, 'utf8') as string).replace(/\/\*[\s\S]*?\*\//g, '')

function ruleBody(selector: string) {
  const pattern = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm')
  return pattern.exec(css)?.[1] ?? null
}

describe('data grid header/body alignment', () => {
  // Regression guard: `.data-grid-row` is a <button>, so Chrome's UA default
  // `padding: 1px 6px` applies unless reset. With box-sizing: border-box and an
  // explicit pixel width, that 6px left padding offsets every body grid track
  // 6px right of its header cell — a uniform misalignment across all columns,
  // which happens to cancel out only at maximum horizontal scroll.
  // jsdom has no layout engine, so this asserts the declaration rather than the
  // rendered geometry; visual confirmation has to happen in a real browser.
  it('resets the UA button padding on grid rows', () => {
    const body = ruleBody('.data-grid-row')
    expect(body).not.toBeNull()
    expect(body!.replace(/\s+/g, ' ')).toMatch(/padding:\s*0\s*;/)
  })
})
