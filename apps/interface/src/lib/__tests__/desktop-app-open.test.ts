import {
  getComingSoonAppKey,
  isComingSoonDesktopApp,
  shouldRouteViaDesktopOpen,
  toDesktopAppSlug,
} from '../desktop-app-open';

describe('desktop app open routing', () => {
  it('routes Agency aliases to the real Agency app', () => {
    expect(toDesktopAppSlug('agency')).toBe('agency');
    expect(toDesktopAppSlug('the-agency')).toBe('agency');
    expect(shouldRouteViaDesktopOpen('the-agency')).toBe(true);
    expect(isComingSoonDesktopApp('agency')).toBe(false);
    expect(getComingSoonAppKey('the-agency')).toBeNull();
  });

  it('routes FileSpace aliases to the real files app', () => {
    expect(toDesktopAppSlug('filespace')).toBe('files');
    expect(shouldRouteViaDesktopOpen('filespace')).toBe(true);
    expect(isComingSoonDesktopApp('files')).toBe(false);
    expect(getComingSoonAppKey('filespace')).toBeNull();
  });

  it('routes Our PearlOS aliases to the real community features app', () => {
    expect(toDesktopAppSlug('ourpearlos')).toBe('our-pearlos');
    expect(toDesktopAppSlug('feature-catalog')).toBe('our-pearlos');
    expect(shouldRouteViaDesktopOpen('our-pearlos')).toBe(true);
    expect(isComingSoonDesktopApp('our-pearlos')).toBe(false);
    expect(getComingSoonAppKey('ourpearlos')).toBeNull();
  });

  it('routes Settings aliases to the desktop settings launcher', () => {
    expect(toDesktopAppSlug('preferences')).toBe('settings');
    expect(toDesktopAppSlug('profile-settings')).toBe('settings');
    expect(shouldRouteViaDesktopOpen('settings')).toBe(true);
    expect(isComingSoonDesktopApp('settings')).toBe(false);
    expect(getComingSoonAppKey('preferences')).toBeNull();
  });

  it('routes Pulse aliases to the native Pulse app', () => {
    expect(toDesktopAppSlug('pulse')).toBe('pulse');
    expect(toDesktopAppSlug('global-pulse')).toBe('pulse');
    expect(toDesktopAppSlug('social-pulse')).toBe('pulse');
    expect(shouldRouteViaDesktopOpen('global-pulse')).toBe(true);
    expect(isComingSoonDesktopApp('pulse')).toBe(false);
    expect(getComingSoonAppKey('social-pulse')).toBeNull();
  });

  it('routes Pearl Vision aliases to the real app launcher', () => {
    expect(toDesktopAppSlug('pearl-vision')).toBe('pearlvision');
    expect(shouldRouteViaDesktopOpen('pearl-vision')).toBe(true);
    expect(isComingSoonDesktopApp('pearlvision')).toBe(false);
    expect(getComingSoonAppKey('pearl-vision')).toBeNull();
  });
});
