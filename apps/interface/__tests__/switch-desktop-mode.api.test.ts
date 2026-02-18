import { NextRequest } from 'next/server';

// Import after mocks are set up (no mocking needed for this route)
// eslint-disable-next-line import/order
import { POST as switchDesktopPOST, GET as switchDesktopGET } from '../src/app/api/switch-desktop-mode/route';

describe('/api/switch-desktop-mode', () => {
  describe('POST /api/switch-desktop-mode', () => {
    it('should successfully switch to valid mode', async () => {
      const request = new NextRequest('http://localhost/api/switch-desktop-mode', {
        method: 'POST',
        body: JSON.stringify({ mode: 'work', userRequest: 'Switch to work mode' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await switchDesktopPOST(request);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.mode).toBe('work');
      expect(data.action).toBe('SWITCH_DESKTOP_MODE');
      expect(data.payload.targetMode).toBe('work');
      expect(data.userRequest).toBe('Switch to work mode');
      expect(data.timestamp).toBeDefined();
    });

    it('should return 400 for invalid mode', async () => {
      const request = new NextRequest('http://localhost/api/switch-desktop-mode', {
        method: 'POST',
        body: JSON.stringify({ mode: 'invalid-mode' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await switchDesktopPOST(request);
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.error).toBe('Invalid mode specified');
      expect(data.validModes).toContain('home');
      expect(data.validModes).toContain('work');
      expect(data.validModes).toContain('creative');
      expect(data.validModes).toContain('gaming');
      expect(data.validModes).toContain('focus');
      expect(data.validModes).toContain('relaxation');
      expect(data.message).toContain('Please specify one of:');
    });

    it('should return 400 when mode is missing', async () => {
      const request = new NextRequest('http://localhost/api/switch-desktop-mode', {
        method: 'POST',
        body: JSON.stringify({ userRequest: 'Switch mode' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await switchDesktopPOST(request);
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.error).toBe('Invalid mode specified');
      expect(data.validModes).toBeDefined();
    });

    it('should handle malformed JSON gracefully', async () => {
      const request = new NextRequest('http://localhost/api/switch-desktop-mode', {
        method: 'POST',
        body: 'invalid-json',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await switchDesktopPOST(request);
      expect(response.status).toBe(500);
      
      const data = await response.json();
      expect(data.error).toBe('Failed to process desktop mode switch');
    });

    it('should work with all valid modes', async () => {
      const validModes = ['home', 'work', 'creative', 'gaming', 'focus', 'relaxation'];
      
      for (const mode of validModes) {
        const request = new NextRequest('http://localhost/api/switch-desktop-mode', {
          method: 'POST',
          body: JSON.stringify({ mode }),
          headers: { 'Content-Type': 'application/json' },
        });

        const response = await switchDesktopPOST(request);
        expect(response.status).toBe(200);
        
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.mode).toBe(mode);
        expect(data.action).toBe('SWITCH_DESKTOP_MODE');
        expect(data.payload.targetMode).toBe(mode);
      }
    });
  });

  describe('GET /api/switch-desktop-mode', () => {
    it('should return API documentation when no mode specified', async () => {
      const request = new NextRequest('http://localhost/api/switch-desktop-mode');

      const response = await switchDesktopGET(request);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.message).toBe('Desktop Mode Switcher API');
      expect(data.availableModes).toContain('home');
      expect(data.availableModes).toContain('work');
      expect(data.usage).toContain('POST request');
    });

    it('should simulate mode switch when mode is provided', async () => {
      const request = new NextRequest('http://localhost/api/switch-desktop-mode?mode=gaming');

      const response = await switchDesktopGET(request);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.mode).toBe('gaming');
      expect(data.action).toBe('SWITCH_DESKTOP_MODE');
      expect(data.payload.targetMode).toBe('gaming');
      expect(data.payload.switchReason).toBe('API test');
    });
  });
});
