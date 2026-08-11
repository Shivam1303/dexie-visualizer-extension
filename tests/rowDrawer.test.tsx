/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DataSource } from '../src/datasource/types'
import { RowDrawer } from '../src/panel/features/detail/RowDrawer'
import { makePreviewValue } from '../src/shared/rowPreview'

afterEach(cleanup)

describe('RowDrawer', () => {
  it('fetches the complete record only after a preview row is opened', async () => {
    const getRow = vi.fn().mockResolvedValue({
      id: 1,
      profile: { active: true, name: 'Ada' },
    })
    const source = {
      getRow,
      update: vi.fn(),
      deleteRow: vi.fn(),
    } as unknown as DataSource

    render(
      <RowDrawer
        dbName="FixtureDB"
        onChanged={() => undefined}
        onClose={() => undefined}
        row={{
          key: 1,
          value: { id: 1, profile: makePreviewValue('object', 2) },
        }}
        source={source}
        sourceMode="imported"
        storeName="users"
      />,
    )

    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Loading complete record')
    await waitFor(() => expect(getRow).toHaveBeenCalledWith('FixtureDB', 'users', 1))
    expect(await screen.findByText('profile')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit profile.active' })).toHaveTextContent('true')
  })
})
