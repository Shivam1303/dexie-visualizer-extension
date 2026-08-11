/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StoreMeta } from '../src/datasource/types'
import { DatabaseOverview } from '../src/panel/features/overview/DatabaseOverview'
import { WorkspaceSidebar } from '../src/panel/features/overview/WorkspaceSidebar'
import { useAppStore } from '../src/panel/store'
import type { Connection } from '../src/shared/rpc'

const connection: Connection = {
  tabId: 7,
  origin: 'https://shop.example',
  title: 'Shop',
  status: 'connected',
}

const stores: StoreMeta[] = [
  {
    name: 'users',
    keyPath: 'id',
    autoIncrement: false,
    indexes: [{ name: 'email', keyPath: 'email', unique: true, multiEntry: false }],
    count: 12,
  },
  {
    name: 'sessions',
    keyPath: null,
    autoIncrement: true,
    indexes: [],
    count: 3,
  },
]

beforeEach(() => {
  useAppStore.setState({ connection, sourceMode: 'live', dbName: 'ShopDB', storeName: null })
})

afterEach(cleanup)

describe('full-page workspace', () => {
  it('clears database and store selections when changing data source', () => {
    useAppStore.setState({ sourceMode: 'live', dbName: 'ShopDB', storeName: 'users' })
    useAppStore.getState().setSourceMode('imported')
    expect(useAppStore.getState()).toMatchObject({
      sourceMode: 'imported',
      dbName: null,
      storeName: null,
    })
  })

  it('summarizes the live database and opens a store from its overview card', () => {
    render(
      <DatabaseOverview
        database={{ name: 'ShopDB', version: 4 }}
        databases={[{ name: 'ShopDB', version: 4 }]}
        loading={false}
        stores={stores}
      />,
    )

    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Database overview' })).toBeInTheDocument()
    expect(screen.queryByText('ShopDB')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /users/i }))
    expect(useAppStore.getState().storeName).toBe('users')
  })

  it('keeps store navigation visible and filters it by name', () => {
    render(
      <WorkspaceSidebar
        connection={connection}
        databases={[{ name: 'ShopDB', version: 4 }]}
        loadingDatabases={false}
        loadingStores={false}
        stores={stores}
        sourceMode="live"
        importedSession={null}
        onSourceMode={() => undefined}
        onImport={() => undefined}
        onRemoveImported={() => undefined}
      />,
    )

    expect(screen.queryByText(connection.origin ?? '')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Find a store'), { target: { value: 'user' } })
    expect(screen.getByRole('button', { name: /users/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sessions/i })).not.toBeInTheDocument()
  })
})
