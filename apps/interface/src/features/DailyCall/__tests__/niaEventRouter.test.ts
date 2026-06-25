/**
 * niaEventRouter.test.ts
 * 
 * Tests for event routing system
 * 
 * Run with: npm test -- niaEventRouter.test.ts
 */

import {
  routeNiaEvent,
  EventEnum,
  NIA_EVENT_DESKTOP_MODE_SWITCH,
  NIA_EVENT_ONBOARDING_COMPLETE,
} from '../events/niaEventRouter';

describe('niaEventRouter', () => {
  describe('DESKTOP_MODE_SWITCH event', () => {
    it('should dispatch CustomEvent when DESKTOP_MODE_SWITCH is routed', (done) => {
      // Listen for the event
      const listener = (event: Event) => {
        const customEvent = event as CustomEvent;
        expect(customEvent.detail.mode).toBe('desktop');
        expect(customEvent.detail.timestamp).toBeDefined();
        
        window.removeEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, listener);
        done();
      };

      window.addEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, listener);

      // Route the event
      routeNiaEvent(EventEnum.DESKTOP_MODE_SWITCH, { mode: 'desktop' });
    });

    it('should dispatch CustomEvent for mobile mode', (done) => {
      const listener = (event: Event) => {
        const customEvent = event as CustomEvent;
        expect(customEvent.detail.mode).toBe('mobile');
        
        window.removeEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, listener);
        done();
      };

      window.addEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, listener);
      routeNiaEvent(EventEnum.DESKTOP_MODE_SWITCH, { mode: 'mobile' });
    });

    it('should dispatch CustomEvent for tablet mode', (done) => {
      const listener = (event: Event) => {
        const customEvent = event as CustomEvent;
        expect(customEvent.detail.mode).toBe('tablet');
        
        window.removeEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, listener);
        done();
      };

      window.addEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, listener);
      routeNiaEvent(EventEnum.DESKTOP_MODE_SWITCH, { mode: 'tablet' });
    });

    it('should use default mode if not provided', (done) => {
      const listener = (event: Event) => {
        const customEvent = event as CustomEvent;
        expect(customEvent.detail.mode).toBe('desktop');
        
        window.removeEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, listener);
        done();
      };

      window.addEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, listener);
      routeNiaEvent(EventEnum.DESKTOP_MODE_SWITCH, {});
    });

    it('should include timestamp in event detail', (done) => {
      const listener = (event: Event) => {
        const customEvent = event as CustomEvent;
        expect(customEvent.detail.timestamp).toBeDefined();
        expect(typeof customEvent.detail.timestamp).toBe('number');
        
        window.removeEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, listener);
        done();
      };

      window.addEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, listener);
      routeNiaEvent(EventEnum.DESKTOP_MODE_SWITCH, { mode: 'desktop' });
    });
  });

  describe('Error handling', () => {
    it('should handle unknown event types gracefully', () => {
      expect(() => {
        routeNiaEvent('UNKNOWN_EVENT_TYPE', {});
      }).not.toThrow();
    });

    it('should handle events without payload', () => {
      const listener = (event: Event) => {
        const customEvent = event as CustomEvent;
        expect(customEvent.detail.mode).toBe('desktop'); // Should use default
        window.removeEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, listener);
      };

      window.addEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, listener);
      routeNiaEvent(EventEnum.DESKTOP_MODE_SWITCH);
    });
  });

  describe('onboarding.complete backend event', () => {
    it('dispatches the frontend onboarding completion event', (done) => {
      const listener = (event: Event) => {
        const customEvent = event as CustomEvent;
        expect(customEvent.detail.timestamp).toBeDefined();

        window.removeEventListener(NIA_EVENT_ONBOARDING_COMPLETE, listener);
        done();
      };

      window.addEventListener(NIA_EVENT_ONBOARDING_COMPLETE, listener);
      routeNiaEvent('onboarding.complete', {});
    });
  });
});
