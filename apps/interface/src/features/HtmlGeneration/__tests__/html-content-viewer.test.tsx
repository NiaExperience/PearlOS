/**
 * @jest-environment jsdom
 */

/**
 * Smoke test: HtmlContentViewer injects provided HTML into iframe via blob.
 */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { HtmlContentViewer } from '../components/HtmlContentViewer';

jest.mock('@interface/contexts/voice-session-context', () => ({
  useVoiceSessionContext: () => ({ roomUrl: null })
}));

describe('HtmlContentViewer', () => {
  it('renders iframe element with HTML content', () => {
    const { container } = render(
      <HtmlContentViewer
        contentType="game"
        htmlContent="<html><head><title>t</title></head><body><div id='root'>Hello</div></body></html>"
        onClose={() => {}}
      />
    );
    // Iframe should be rendered with proper sandbox attributes
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  });
});
