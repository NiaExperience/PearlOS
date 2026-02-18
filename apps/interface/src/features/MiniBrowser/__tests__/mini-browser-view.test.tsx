/**
 * @jest-environment jsdom
 */

/**
 * Smoke test: MiniBrowserView mounts and basic navigation buttons exist.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import MiniBrowserView from '../components/MiniBrowserView';

describe('MiniBrowserView', () => {
  it('renders initial UI controls', () => {
    render(<MiniBrowserView initialUrl="https://example.com" />);
    expect(screen.getByTitle(/Go Back/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Go Forward/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Refresh/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Home/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Enter URL or search term/i)).toBeInTheDocument();
  });
});
