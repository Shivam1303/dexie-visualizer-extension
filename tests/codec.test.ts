import { describe, expect, it } from 'vitest'
import { decode, encode, isOpaque } from '../src/shared/codec'

// Mirrors what chrome.runtime.sendMessage actually does to a payload.
const round = (value: unknown) => decode(JSON.parse(JSON.stringify(encode(value))))

describe('codec', () => {
  it('round-trips primitives unchanged', () => {
    expect(round({ a: 1, b: 'x', c: true, d: null })).toEqual({ a: 1, b: 'x', c: true, d: null })
  })

  it('preserves Date as a real Date, not a string', () => {
    const out: any = round({ at: new Date('2026-05-20T10:46:00.000Z') })
    expect(out.at).toBeInstanceOf(Date)
    expect(out.at.toISOString()).toBe('2026-05-20T10:46:00.000Z')
  })

  it('preserves undefined instead of dropping the key', () => {
    const out: any = round({ maybe: undefined })
    expect('maybe' in out).toBe(true)
    expect(out.maybe).toBeUndefined()
  })

  it('round-trips Map and Set', () => {
    const out: any = round({ m: new Map([['k', 1]]), s: new Set([1, 2]) })
    expect(out.m).toBeInstanceOf(Map)
    expect(out.m.get('k')).toBe(1)
    expect(out.s).toBeInstanceOf(Set)
    expect([...out.s]).toEqual([1, 2])
  })

  it('round-trips BigInt', () => {
    const out: any = round({ big: 9007199254740993n })
    expect(out.big).toBe(9007199254740993n)
  })

  it('marks binary values opaque rather than corrupting them', () => {
    const out: any = round({ buf: new Uint8Array([1, 2, 3]).buffer })
    expect(isOpaque(out.buf)).toBe(true)
    expect(out.buf.kind).toBe('ArrayBuffer')
    expect(out.buf.size).toBe(3)
  })

  it('marks a Blob opaque and keeps its mime type', () => {
    const out: any = round({ pic: new Blob(['hello'], { type: 'image/png' }) })
    expect(isOpaque(out.pic)).toBe(true)
    expect(out.pic.kind).toBe('Blob')
    expect(out.pic.mime).toBe('image/png')
  })

  it('round-trips nested structures and arrays', () => {
    const out: any = round({ list: [{ at: new Date(0) }, [1, 2]] })
    expect(out.list[0].at).toBeInstanceOf(Date)
    expect(out.list[1]).toEqual([1, 2])
  })

  it('round-trips a Date used as a primary key', () => {
    const out = round(new Date('2026-01-01T00:00:00.000Z'))
    expect(out).toBeInstanceOf(Date)
  })

  it('does not treat a plain object as a tagged value', () => {
    const out: any = round({ __t: 'date', v: 'not-really-a-date' })
    expect(out).toEqual({ __t: 'date', v: 'not-really-a-date' })
  })
})
