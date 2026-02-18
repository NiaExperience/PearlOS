/**
 * @jest-environment jsdom
 */

/**
 * Smoke test: GoogleDriveView mounts without error.
 */
import React from 'react';
import { render } from '@testing-library/react';
import GoogleDriveView from '../components/GoogleDriveView';

describe('GoogleDriveView', () => {
  it('mounts without crashing', () => {
    render(<GoogleDriveView />);
  });
});
