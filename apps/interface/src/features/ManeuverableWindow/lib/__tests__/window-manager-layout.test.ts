import {
  isPearlOSFullscreenView,
  isPearlOSNativeView,
  isFullscreenWindowView,
  layoutForWindows,
  type WindowDescriptor,
} from '../WindowManagerContext';
import type { ViewType } from '../windowLifecycleController';

function descriptor(viewType: ViewType, meta?: Record<string, unknown>): WindowDescriptor {
  return {
    id: String(viewType || 'window'),
    viewType,
    title: String(viewType || 'Window'),
    slot: 'center',
    zIndex: 1,
    widthFraction: 1,
    heightFraction: 1,
    meta,
    createdAt: 0,
    contentVersion: 0,
  };
}

describe('WindowManager layout classification', () => {
  it('treats first-party PearlOS apps as fullscreen native windows', () => {
    expect(isPearlOSNativeView('ourPearlos')).toBe(true);
    expect(isPearlOSNativeView('gmail')).toBe(true);
    expect(isPearlOSNativeView('terminal')).toBe(true);
    expect(isPearlOSNativeView('docs')).toBe(true);
    expect(isPearlOSNativeView('styles')).toBe(true);

    expect(isPearlOSFullscreenView('ourPearlos')).toBe(true);
    expect(isPearlOSFullscreenView('gmail')).toBe(true);
    expect(isPearlOSFullscreenView('terminal')).toBe(true);
    expect(isPearlOSFullscreenView('docs')).toBe(true);
    expect(isPearlOSFullscreenView('styles')).toBe(true);

    expect(layoutForWindows([descriptor('ourPearlos')])).toBe('content-only');
    expect(layoutForWindows([descriptor('gmail')])).toBe('content-only');
    expect(layoutForWindows([descriptor('docs')])).toBe('content-only');
    expect(layoutForWindows([descriptor('styles')])).toBe('content-only');
  });

  it('keeps external browser surfaces out of PearlOS app classification while allowing fullscreen browser windows', () => {
    expect(isPearlOSNativeView('miniBrowser')).toBe(false);
    expect(isPearlOSNativeView('enhancedBrowser')).toBe(false);
    expect(isPearlOSFullscreenView('miniBrowser')).toBe(false);
    expect(isPearlOSFullscreenView('enhancedBrowser')).toBe(false);
    expect(isFullscreenWindowView('miniBrowser')).toBe(false);
    expect(isFullscreenWindowView('enhancedBrowser')).toBe(false);

    expect(isPearlOSNativeView('browser')).toBe(true);
    expect(isPearlOSFullscreenView('browser')).toBe(false);
    expect(isFullscreenWindowView('browser')).toBe(true);
    expect(layoutForWindows([descriptor('browser')])).toBe('content-only');

    expect(isPearlOSNativeView('wonderCanvas')).toBe(true);
    expect(isPearlOSFullscreenView('wonderCanvas')).toBe(false);
    expect(isFullscreenWindowView('wonderCanvas')).toBe(false);
  });

  it('preserves explicit fullscreen metadata for generated content', () => {
    expect(layoutForWindows([descriptor('custom', { wonder: true, fullscreen: true })])).toBe('content-only');
    expect(layoutForWindows([descriptor('wonderCanvas', { wonder: true, wonderLayout: 'split' })])).toBe('split');
    expect(layoutForWindows([descriptor('custom', { fullscreenWindow: true })])).toBe('content-only');
  });
});
