/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';

import { AppearancePanel } from '../AppearancePanel';

jest.mock('@interface/hooks/use-interface-customization', () => ({
  useInterfaceCustomization: () => ({
    theme: 'pixel',
    backgrounds: {
      home: '/backgrounds/home-sunset.png',
      desktop: '/backgrounds/desktop-forest.png',
    },
    icons: {},
    customThemes: [],
    updatedAt: 0,
  }),
}));

describe('AppearancePanel', () => {
  it('shows visual previews for base themes before selection', () => {
    render(<AppearancePanel title="Styles" description="Theme previews" />);

    const pixel = screen.getByRole('button', { name: 'Pixel' });
    const glass = screen.getByRole('button', { name: 'Glass' });

    expect(pixel.querySelector('span[aria-hidden="true"]')).toHaveStyle({
      backgroundSize: '100% 100%, 55% 100%, 55% 100%',
    });
    expect(pixel.querySelector('span[aria-hidden="true"]')).toHaveAttribute('data-preview-home', '/backgrounds/home-sunset.png');
    expect(pixel.querySelector('span[aria-hidden="true"]')).toHaveAttribute('data-preview-desktop', '/backgrounds/desktop-forest.png');
    expect(glass.querySelector('span[aria-hidden="true"]')).toHaveAttribute('data-preview-home', '/backgrounds/pearl-aurora.png');
    expect(glass.querySelector('span[aria-hidden="true"]')).toHaveAttribute('data-preview-desktop', '/backgrounds/pearl-cosmic.png');
  });
});
