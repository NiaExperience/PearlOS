/**
 * @jest-environment jsdom
 */

/**
 * Smoke test: GmailView renders fallback structure (timer not awaited).
 */
import React from 'react';
import { render } from '@testing-library/react';
import GmailView from '../components/gmail-view';

describe('GmailView', () => {
  it('mounts without crashing', () => {
    render(<GmailView />);
  });
});
