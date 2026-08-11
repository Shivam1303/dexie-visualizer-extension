/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataSource, QueryOptions, StoreMeta, TableQuery } from '../src/datasource/types'
import { TableBrowser } from '../src/panel/features/table/TableBrowser'

const storeMeta: StoreMeta = {
  name: 'users',
  keyPath: 'id',
  autoIncrement: false,
  indexes: [],
  count: 51,
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TableBrowser pagination', () => {
  it('cancels the previous request and clamps a page after the total shrinks', async () => {
    let shrunk = false
    const query = vi.fn(
      async (
        _dbName: string,
        _storeName: string,
        request: TableQuery,
        _options?: QueryOptions,
      ) => {
        if (request.page === 1) {
          shrunk = true
          return { rows: [], total: 1, page: 1, pageSize: request.pageSize }
        }
        return {
          rows: [{ key: 1, value: { id: 1 } }],
          total: shrunk ? 1 : 51,
          page: 0,
          pageSize: request.pageSize,
        }
      },
    )
    const source = {
      sampleRows: vi.fn().mockResolvedValue([{ id: 1 }]),
      query,
      getRow: vi.fn(),
      update: vi.fn(),
      deleteRow: vi.fn(),
    } as unknown as DataSource

    render(
      <TableBrowser
        dbName="FixtureDB"
        source={source}
        sourceMode="imported"
        storeMeta={storeMeta}
        storeName="users"
      />,
    )

    const next = await screen.findByRole('button', { name: 'Next' })
    await waitFor(() => expect(next).toBeEnabled())
    const firstSignal = query.mock.calls[0]?.[3]?.signal
    fireEvent.click(next)

    await waitFor(() => {
      expect(query.mock.calls.map((call) => call[2].page)).toEqual([0, 1, 0])
    })
    expect(firstSignal?.aborted).toBe(true)
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
  })

  it('exposes the current sort direction to assistive technology', async () => {
    const source = {
      sampleRows: vi.fn().mockResolvedValue([{ id: 1 }]),
      query: vi.fn().mockResolvedValue({
        rows: [{ key: 1, value: { id: 1 } }],
        total: 1,
        page: 0,
        pageSize: 50,
      }),
    } as unknown as DataSource

    render(
      <TableBrowser dbName="FixtureDB" source={source} sourceMode="imported" storeName="users" />,
    )

    const header = await screen.findByRole('columnheader', { name: /id/i })
    expect(header).toHaveAttribute('aria-sort', 'none')
    fireEvent.click(screen.getByRole('button', { name: 'Sort by id' }))
    expect(header).toHaveAttribute('aria-sort', 'ascending')
  })

  it('keeps the header aligned while scrolling and resizes columns from one shared width', async () => {
    const source = {
      sampleRows: vi.fn().mockResolvedValue([{ id: 1, description: 'A long description' }]),
      query: vi.fn().mockResolvedValue({
        rows: [{ key: 1, value: { id: 1, description: 'A long description' } }],
        total: 1,
        page: 0,
        pageSize: 50,
      }),
    } as unknown as DataSource

    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('data-grid-body') ? 500 : 0
    })
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('data-grid-body') ? 483 : 0
    })

    const { container } = render(
      <TableBrowser
        dbName="FixtureDB"
        source={source}
        sourceMode="imported"
        storeName="users"
      />,
    )

    const resizer = await screen.findByRole('separator', { name: 'Resize id column' })
    expect(resizer).toHaveAttribute('aria-valuenow', '180')
    fireEvent.keyDown(resizer, { key: 'ArrowRight' })
    expect(resizer).toHaveAttribute('aria-valuenow', '204')

    const headerGrid = container.querySelector<HTMLElement>('.data-grid-header')
    expect(headerGrid?.style.gridTemplateColumns).toBe('204px 180px')
    expect(headerGrid?.style.width).toBe('384px')

    const body = container.querySelector<HTMLElement>('.data-grid-body')
    const headerViewport = container.querySelector<HTMLElement>('.data-grid-header-viewport')
    expect(body).not.toBeNull()
    expect(headerViewport).not.toBeNull()
    expect(headerViewport?.style.paddingRight).toBe('17px')
    body!.scrollLeft = 260
    fireEvent.scroll(body!)
    expect(headerViewport?.scrollLeft).toBe(260)
  })
})
