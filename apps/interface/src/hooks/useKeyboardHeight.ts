import { useEffect, useState, useCallback, useRef } from 'react';

/**
 * Detects iOS Safari — matches pattern from SoundtrackProvider
 */
export function isIOSSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isWebKit = /WebKit/.test(ua);
  const isChrome = /CriOS/.test(ua);
  return isIOS && isWebKit && !isChrome;
}

interface KeyboardState {
  /** Keyboard height in pixels (0 when closed) */
  keyboardHeight: number;
  /** Whether the keyboard is currently visible */
  isKeyboardOpen: boolean;
  /** The visible viewport height (shrinks when keyboard opens) */
  viewportHeight: number;
  /** Whether this is iOS Safari */
  isIOS: boolean;
}

/**
 * Reusable hook for detecting iOS Safari virtual keyboard height
 * using the visualViewport API.
 *
 * On non-iOS browsers, keyboardHeight stays 0 — layout uses normal CSS.
 */
export function useKeyboardHeight(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({
    keyboardHeight: 0,
    isKeyboardOpen: false,
    viewportHeight: 0, // Initialized in useEffect to avoid hydration mismatch
    isIOS: false,
  });

  // Store initial full viewport height (before keyboard)
  const fullHeightRef = useRef(0);
  // Debounce timer to smooth iOS bounce behavior
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleResize = useCallback(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // Clear any pending debounce
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      const currentHeight = vv.height;
      // Update full height only when keyboard is clearly closed
      // (viewport height close to window.innerHeight)
      if (Math.abs(currentHeight - window.innerHeight) < 100) {
        fullHeightRef.current = window.innerHeight;
      }

      const diff = fullHeightRef.current - currentHeight;
      // Threshold: keyboards are typically > 200px
      const isOpen = diff > 150;

      setState({
        keyboardHeight: isOpen ? diff : 0,
        isKeyboardOpen: isOpen,
        viewportHeight: currentHeight,
        isIOS: true,
      });
    }, 50); // 50ms debounce smooths iOS bounce
  }, []);

  useEffect(() => {
    if (!isIOSSafari()) {
      setState(s => ({ ...s, isIOS: false }));
      return;
    }

    fullHeightRef.current = window.innerHeight;
    setState(s => ({
      ...s,
      isIOS: true,
      viewportHeight: window.innerHeight,
    }));

    const vv = window.visualViewport;
    if (!vv) return;

    vv.addEventListener('resize', handleResize);
    vv.addEventListener('scroll', handleResize);

    return () => {
      vv.removeEventListener('resize', handleResize);
      vv.removeEventListener('scroll', handleResize);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [handleResize]);

  return state;
}
