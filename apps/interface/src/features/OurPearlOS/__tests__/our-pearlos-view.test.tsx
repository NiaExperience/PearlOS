/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import type { DecoratedCatalog, DecoratedFeature } from '@interface/lib/our-pearlos-catalog';

import OurPearlOSView from '../OurPearlOSView';

function feature(over: Partial<DecoratedFeature>): DecoratedFeature {
  return {
    id: 'shared-notes-pin',
    title: 'Pinned quick notes',
    summary: 'Keep a small notes panel pinned.',
    status: 'community',
    baseVotes: 5,
    voteCount: 5,
    hasVoted: false,
    votable: true,
    ...over,
  };
}

function catalog(over: Partial<DecoratedCatalog> = {}): DecoratedCatalog {
  return {
    public: [feature({ id: 'desktop-themes', title: 'Personal desktop themes', status: 'public', votable: false })],
    integrating: [],
    community: [feature({})],
    ...over,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function forum(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    signedIn: true,
    viewerLabel: 'Blair E.',
    topics: [],
    ...over,
  };
}

function mockOurPearlOSFetch(options: {
  catalogBody?: DecoratedCatalog;
  signedIn?: boolean;
  installedFeatureIds?: Record<string, true>;
  forumBody?: Record<string, unknown>;
  voteFeature?: DecoratedFeature;
} = {}) {
  return jest.fn((url: unknown, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('/api/our-pearlos/forum')) {
      return Promise.resolve(jsonResponse(forum({
        signedIn: options.signedIn ?? true,
        ...options.forumBody,
      })));
    }
    if (href.includes('/api/our-pearlos/vote')) {
      return Promise.resolve(jsonResponse({ ok: true, feature: options.voteFeature ?? feature({ hasVoted: true, voteCount: 6 }) }));
    }
    if (href.includes('/api/our-pearlos/install')) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      return Promise.resolve(jsonResponse({
        ok: true,
        installedFeatureIds: body.installed === false
          ? {}
          : (options.installedFeatureIds ?? { [body.featureId ?? 'shared-notes-pin']: true }),
      }));
    }
    return Promise.resolve(jsonResponse({
      ok: true,
      catalog: options.catalogBody ?? catalog(),
      installedFeatureIds: options.installedFeatureIds ?? {},
      signedIn: options.signedIn ?? true,
    }));
  }) as unknown as typeof fetch;
}

const originalFetch = global.fetch;

describe('OurPearlOSView', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    window.localStorage.clear();
  });

  it('renders the three sections from the catalog without a refresh button', async () => {
    global.fetch = mockOurPearlOSFetch();
    render(<OurPearlOSView />);

    expect(await screen.findByText('Personal desktop themes')).toBeInTheDocument();
    expect(screen.getByText('Community forum')).toBeInTheDocument();
    expect(await screen.findByText('Posting as - Blair E.')).toBeInTheDocument();
    expect(screen.getByText('Pinned quick notes')).toBeInTheDocument();
    expect(screen.getByText('Latest public features')).toBeInTheDocument();
    expect(screen.getByText('Integrating next build')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Refresh features/i })).not.toBeInTheDocument();
  });

  it('casts a vote and reflects the updated count', async () => {
    const fetchMock = mockOurPearlOSFetch();
    global.fetch = fetchMock;

    render(<OurPearlOSView />);
    const voteBtn = await screen.findByRole('button', { name: /Vote for Pinned quick notes/i });
    expect(voteBtn).toHaveTextContent('5');

    fireEvent.click(voteBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/our-pearlos/vote',
        expect.objectContaining({ method: 'POST' })
      );
    });
    await screen.findByRole('button', { name: /Remove your vote for Pinned quick notes/i });
  });

  it('disables voting when signed out', async () => {
    global.fetch = mockOurPearlOSFetch({ signedIn: false, forumBody: { viewerLabel: null } });
    render(<OurPearlOSView />);
    const voteBtn = await screen.findByRole('button', { name: /Vote for Pinned quick notes/i });
    expect(voteBtn).toBeDisabled();
    expect(screen.getByText(/Sign in to vote on community features and post in the forum/i)).toBeInTheDocument();
    expect(await screen.findByText(/Sign in to start topics and reply/i)).toBeInTheDocument();
  });

  it('adds a community feature to my PearlOS locally', async () => {
    const fetchMock = mockOurPearlOSFetch();
    global.fetch = fetchMock;
    render(<OurPearlOSView />);

    fireEvent.click(await screen.findByRole('button', { name: /Install Pinned quick notes to my PearlOS/i }));

    expect(await screen.findByRole('button', { name: /Remove Pinned quick notes from my PearlOS/i })).toBeEnabled();
    expect(window.localStorage.getItem('pearlos:our-pearlos-installed-features:v1')).toContain('shared-notes-pin');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/our-pearlos/install',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ featureId: 'shared-notes-pin', installed: true }),
        })
      );
    });
  });

  it('drops a real desktop shortcut when adding a feature without a launch URL', async () => {
    // Regression: curated community features carry no launchUrl, so "Install" used to
    // flip the label but create no desktop icon — looking like it did nothing.
    global.fetch = mockOurPearlOSFetch();
    render(<OurPearlOSView />);

    fireEvent.click(await screen.findByRole('button', { name: /Install Pinned quick notes to my PearlOS/i }));
    await screen.findByRole('button', { name: /Remove Pinned quick notes from my PearlOS/i });

    const shortcuts = JSON.parse(window.localStorage.getItem('pearlos:desktop-shortcuts:v1') ?? '{}');
    const added = (shortcuts.shortcuts ?? []).find((s: { id: string }) => s.id === 'our-pearlos:shared-notes-pin');
    expect(added).toBeTruthy();
    expect(added.title).toBe('Pinned quick notes');
    expect(added.target).toMatchObject({ kind: 'native-app', viewType: 'ourPearlos' });

    // Removing it takes the icon back off the desktop.
    fireEvent.click(await screen.findByRole('button', { name: /Remove Pinned quick notes from my PearlOS/i }));
    await screen.findByRole('button', { name: /Install Pinned quick notes to my PearlOS/i });
    const afterRemove = JSON.parse(window.localStorage.getItem('pearlos:desktop-shortcuts:v1') ?? '{}');
    expect((afterRemove.shortcuts ?? []).some((s: { id: string }) => s.id === 'our-pearlos:shared-notes-pin')).toBe(false);
  });

  it('recreates desktop shortcuts from server-installed features on load', async () => {
    global.fetch = mockOurPearlOSFetch({ installedFeatureIds: { 'shared-notes-pin': true } });
    render(<OurPearlOSView />);

    expect(await screen.findByRole('button', { name: /Remove Pinned quick notes from my PearlOS/i })).toBeEnabled();
    const shortcuts = JSON.parse(window.localStorage.getItem('pearlos:desktop-shortcuts:v1') ?? '{}');
    const added = (shortcuts.shortcuts ?? []).find((s: { id: string }) => s.id === 'our-pearlos:shared-notes-pin');
    expect(added).toBeTruthy();
    expect(added.target).toMatchObject({ kind: 'native-app', viewType: 'ourPearlos' });
  });

  it('installs workspace extras as three native desktop shortcuts', async () => {
    const workspacePack = feature({
      id: 'workspace-extras-pack',
      title: 'Workspace extras pack',
      summary: 'Add Council, Web Browser, and Pulse back to your workspace desktop.',
      baseVotes: 15,
      voteCount: 15,
      sourceType: 'feature_package',
    });
    global.fetch = mockOurPearlOSFetch({
      catalogBody: catalog({ community: [workspacePack] }),
    });
    render(<OurPearlOSView />);

    fireEvent.click(await screen.findByRole('button', { name: /Install Workspace extras pack to my PearlOS/i }));
    await screen.findByRole('button', { name: /Remove Workspace extras pack from my PearlOS/i });

    const shortcuts = JSON.parse(window.localStorage.getItem('pearlos:desktop-shortcuts:v1') ?? '{}');
    expect(shortcuts.shortcuts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'our-pearlos:workspace-extras-pack:council',
        title: 'Council',
        iconSrc: '/icons/council.svg',
        target: expect.objectContaining({ kind: 'native-app', app: 'council', viewType: 'council' }),
      }),
      expect.objectContaining({
        id: 'our-pearlos:workspace-extras-pack:web-browser',
        title: 'Web Browser',
        iconSrc: '/desktopicons/chrome.png',
        target: expect.objectContaining({ kind: 'native-app', app: 'browser', viewType: 'enhancedBrowser' }),
      }),
      expect.objectContaining({
        id: 'our-pearlos:workspace-extras-pack:pulse',
        title: 'Pulse',
        iconSrc: '/desktopicons/social.png',
        target: expect.objectContaining({ kind: 'native-app', app: 'pulse', viewType: 'pulse' }),
      }),
    ]));
    expect((shortcuts.shortcuts ?? []).some((s: { id: string }) => s.id === 'our-pearlos:workspace-extras-pack')).toBe(false);

    fireEvent.click(await screen.findByRole('button', { name: /Remove Workspace extras pack from my PearlOS/i }));
    await screen.findByRole('button', { name: /Install Workspace extras pack to my PearlOS/i });
    const afterRemove = JSON.parse(window.localStorage.getItem('pearlos:desktop-shortcuts:v1') ?? '{}');
    expect((afterRemove.shortcuts ?? []).some((s: { id: string }) => s.id.startsWith('our-pearlos:workspace-extras-pack'))).toBe(false);
  });
});
