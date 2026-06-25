/* @jest-environment jsdom */

import {
  INTERFACE_CUSTOMIZATION_STORAGE_KEY,
  applyInterfaceCustomization,
  getIconOverride,
  generatePixelIconPack,
  normalizeInterfaceTheme,
  readInterfaceCustomization,
  setInterfaceTheme,
  shouldBypassNextImageOptimization,
  writeInterfaceCustomization,
  DESKTOP_ICON_TARGETS,
} from '../interface-customization';

describe('interface customization', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-pearl-theme');
    document.body.removeAttribute('data-pearl-theme');
    document.documentElement.style.removeProperty('--pearl-home-background-image');
    document.documentElement.style.removeProperty('--pearl-desktop-background-image');
  });

  it('normalizes unknown themes to pixel', () => {
    expect(normalizeInterfaceTheme('glass')).toBe('glass');
    expect(normalizeInterfaceTheme('neon')).toBe('pixel');
  });

  it('stores only local image URLs and applies CSS background variables', () => {
    const state = writeInterfaceCustomization({
      theme: 'calm',
      backgrounds: {
        home: '/api/pixel-art/image/home.png',
        desktop: 'https://example.invalid/desktop.png',
      },
      icons: {
        browser: '/api/pixel-art/image/browser.png',
        terminal: 'https://example.invalid/terminal.png',
      },
    });

    expect(state.theme).toBe('calm');
    expect(state.backgrounds.home).toBe('/api/pixel-art/image/home.png');
    expect(state.backgrounds.desktop).toBe('/backgrounds/pearl-ocean.png');
    expect(state.icons.browser).toBe('/api/pixel-art/image/browser.png');
    expect(state.icons.terminal).toBeUndefined();

    const saved = JSON.parse(window.localStorage.getItem(INTERFACE_CUSTOMIZATION_STORAGE_KEY) || '{}');
    expect(saved.theme).toBe('calm');
    expect(document.documentElement.dataset.pearlTheme).toBe('calm');
    expect(document.documentElement.style.getPropertyValue('--pearl-home-background-image')).toContain('/api/pixel-art/image/home.png');
    expect(getIconOverride(state.icons, 'chrome', '/desktopicons/chrome.png')).toBe('/api/pixel-art/image/browser.png');
  });

  it('hydrates and applies stored customization', () => {
    window.localStorage.setItem(INTERFACE_CUSTOMIZATION_STORAGE_KEY, JSON.stringify({
      theme: 'professional',
      backgrounds: { desktop: '/api/pixel-art/image/work.png' },
      icons: {},
      updatedAt: 10,
    }));

    const state = readInterfaceCustomization();
    applyInterfaceCustomization(state);

    expect(document.body.dataset.pearlTheme).toBe('professional');
    expect(document.documentElement.style.getPropertyValue('--pearl-desktop-background-image')).toContain('/api/pixel-art/image/work.png');
  });

  it('applies theme-specific background defaults when switching themes', () => {
    const state = setInterfaceTheme('glass');

    expect(state.backgrounds).toEqual({
      home: '/backgrounds/pearl-aurora.png',
      desktop: '/backgrounds/pearl-cosmic.png',
    });
    expect(document.documentElement.style.getPropertyValue('--pearl-home-background-image')).toContain('/backgrounds/pearl-aurora.png');
    expect(document.documentElement.style.getPropertyValue('--pearl-desktop-background-image')).toContain('/backgrounds/pearl-cosmic.png');
  });

  it('uses the selected theme defaults when switching themes', () => {
    writeInterfaceCustomization({
      theme: 'pixel',
      backgrounds: {
        home: '/api/pixel-art/image/custom-home.png',
        desktop: '/api/pixel-art/image/custom-desktop.png',
      },
    });

    const state = setInterfaceTheme('calm');

    expect(state.backgrounds.home).toBe('/backgrounds/pearl-ocean.png');
    expect(state.backgrounds.desktop).toBe('/backgrounds/pearl-ocean.png');
    expect(document.documentElement.style.getPropertyValue('--pearl-home-background-image')).toContain('/backgrounds/pearl-ocean.png');
    expect(document.documentElement.style.getPropertyValue('--pearl-desktop-background-image')).toContain('/backgrounds/pearl-ocean.png');
  });

  it('resolves custom themes by label and prompt, not only generated id', () => {
    writeInterfaceCustomization({
      theme: 'pixel',
      customThemes: [
        {
          id: 'custom-jurassic-park-m2x',
          label: 'Jurassic Park',
          prompt: 'Dark jungle Jurassic Park theme with amber safety lights',
          backgrounds: {
            home: '/api/pixel-art/image/jurassic-home.png',
            desktop: '/api/pixel-art/image/jurassic-desktop.png',
          },
          icons: {},
          style: { '--pearl-accent': '#f8c44f' },
          createdAt: 10,
          updatedAt: 20,
          generated: true,
        },
      ],
    });

    const byLabel = setInterfaceTheme('Jurassic Park theme');
    expect(byLabel.theme).toBe('custom-jurassic-park-m2x');
    expect(byLabel.backgrounds.desktop).toBe('/api/pixel-art/image/jurassic-desktop.png');
    expect(document.documentElement.dataset.pearlCustomTheme).toBe('custom-jurassic-park-m2x');

    const byPrompt = setInterfaceTheme('amber safety lights');
    expect(byPrompt.theme).toBe('custom-jurassic-park-m2x');
  });

  it('bypasses next/image optimization for generated client-only images', () => {
    expect(shouldBypassNextImageOptimization('/api/pixel-art/image/browser.png')).toBe(true);
    expect(shouldBypassNextImageOptimization('blob:https://pearl.test/icon')).toBe(true);
    expect(shouldBypassNextImageOptimization(`${window.location.origin}/api/pixel-art/image/browser.png`)).toBe(true);
    expect(shouldBypassNextImageOptimization('/desktopicons/chrome.png')).toBe(false);
  });

  it('keeps every desktop icon slot populated when icon generation is unavailable', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async () => new Response('OpenRouter returned 401: Missing Authentication header', { status: 503 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const state = await generatePixelIconPack('noir');
      const expectedKeys = DESKTOP_ICON_TARGETS.map((target) => target.key).sort();

      expect(Object.keys(state.icons).sort()).toEqual(expectedKeys);
      expect(state.icons['our-pearlos']).toBe('/icons/pearl-clam.svg');
      expect(state.icons.pulse).toBe('/desktopicons/social.png');
      expect(fetchMock).toHaveBeenCalledTimes(DESKTOP_ICON_TARGETS.length);
    } finally {
      warnSpy.mockRestore();
      global.fetch = originalFetch;
    }
  });
});
