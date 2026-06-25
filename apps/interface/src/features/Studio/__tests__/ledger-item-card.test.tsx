/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LedgerItemCard from '../components/LedgerItemCard';
import type { StudioLedgerItem } from '@interface/lib/studio-ledger';

function item(over: Partial<StudioLedgerItem> = {}): StudioLedgerItem {
  return {
    id: 'change-1',
    title: 'Calmer desktop',
    kind: 'ui_manifest',
    status: 'applied',
    summary: 'Applied a softer theme.',
    artifactPath: '/srv/pearl-user-workspaces/t/u/task-9/pearlos-ui-customization.json',
    shareEligible: true,
    createdAt: 1,
    updatedAt: 2,
    ...over,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

const originalFetch = global.fetch;

describe('LedgerItemCard', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows status, summary, and only the artifact filename (no internal path)', () => {
    render(<LedgerItemCard item={item()} />);
    expect(screen.getByText('Calmer desktop')).toBeInTheDocument();
    expect(screen.getByText('Applied')).toBeInTheDocument();
    expect(screen.getByText(/pearlos-ui-customization\.json/)).toBeInTheDocument();
    // The internal task directory must never be rendered.
    expect(screen.queryByText(/task-9/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pearl-user-workspaces/)).not.toBeInTheDocument();
  });

  it('does not offer Share for a non-share-eligible item', () => {
    render(<LedgerItemCard item={item({ shareEligible: false, kind: 'code_artifact', status: 'needs_review' })} />);
    expect(screen.queryByRole('button', { name: /Share/i })).not.toBeInTheDocument();
  });

  it('publishes a share-eligible item and notifies the parent', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const onShared = jest.fn();

    render(<LedgerItemCard item={item()} onShared={onShared} />);
    fireEvent.click(screen.getByRole('button', { name: /Share Calmer desktop/i }));

    await waitFor(() => expect(onShared).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/our-pearlos/share',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.ledgerItemId).toBe('change-1');
  });

  it('renders an already-published item as read-only', () => {
    render(
      <LedgerItemCard
        item={item({ share: { publicFeatureId: 'pub-1', sharedAt: 5, status: 'public' } })}
      />
    );
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Share/i })).not.toBeInTheDocument();
  });
});
