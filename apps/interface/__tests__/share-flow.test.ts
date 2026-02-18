import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { TokenEncryption } from '@nia/prism/core/utils/encryption';
import { NextRequest } from 'next/server';

import { getLinkMapByKey } from '@interface/features/ResourceSharing/actions/linkmap-actions';

import { POST as generatePOST } from '../src/app/api/share/generate/route';
import { POST as redeemPOST } from '../src/app/api/share/redeem/route';

// Mock auth
jest.mock('@nia/prism/core/auth/getSessionSafely', () => ({
  getSessionSafely: jest.fn(),
}));

jest.mock('@nia/prism/core/auth', () => ({
  requireAuth: jest.fn().mockResolvedValue(null),
}));

jest.mock('@interface/lib/auth-config', () => ({ interfaceAuthOptions: { mock: 'auth-options' } }));

// Mock Prism actions if we weren't using real DB, but user said use real DB.
// However, we need to make sure Prism can connect.
// If Prism fails to connect in this environment, we might need to mock it.
// For now, let's assume it works or we'll see errors.

const mockGetSessionSafely = getSessionSafely as jest.MockedFunction<typeof getSessionSafely>;

const buildRequest = (url: string, body: any = {}): NextRequest =>
  ({
    url,
    headers: new Headers(),
    json: async () => body,
  } as unknown as NextRequest);

describe('Applet Sharing Flow', () => {
  const userId = 'e0a8eb69-2f1f-4d60-a3ab-57b8256e400e'; // Valid UUID
  const tenantId = 'e0a8eb69-2f1f-4d60-a3ab-57b8256e400e'; // Valid UUID
  // Use a random resource ID to avoid collisions with other tests or previous runs
  const resourceId = `applet-${Math.random().toString(36).substring(7)}`;
  const encryptionKey = '12345678901234567890123456789012'; // 32 chars

  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = encryptionKey;
    process.env.NEXTAUTH_INTERFACE_URL = 'http://localhost:3000';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSessionSafely.mockResolvedValue({
      user: { id: userId, email: 'test@example.com', sessionId: 'session-123' },
      expires: '2099-01-01',
    });
  });

  it('should generate an encrypted token and redeem it successfully', async () => {
    // 1. Generate Token
    const generateReq = buildRequest('http://localhost:3000/api/share/generate', {
      resourceId,
      contentType: 'HtmlGeneration',
      role: 'read-only',
      ttl: 3600,
      tenantId
    });

    const generateRes = await generatePOST(generateReq);
    const generateData = await generateRes.json();

    expect(generateRes.status).toBe(200);
    expect(generateData.success).toBe(true);
    expect(generateData.link).toContain('/share/');
    expect(generateData.token).toBeDefined(); // The raw token (UUID)

    // Extract key from link
    const linkParts = generateData.link.split('/share/');
    const key = linkParts[1];
    
    // Resolve LinkMap to get encrypted token
    const linkMap = await getLinkMapByKey(key);
    expect(linkMap).toBeDefined();
    
    const payload = JSON.parse(linkMap!.json);
    const encryptedToken = payload.token;

    // Verify encryption
    expect(encryptedToken).not.toBe(generateData.token);
    
    // Verify we can decrypt it manually to check
    const decrypted = TokenEncryption.decryptToken(encryptedToken);
    expect(decrypted).toBe(generateData.token);

    // 2. Redeem Token
    // We'll simulate a different user redeeming it, or the same user.
    // Let's use the same user for simplicity, or mock a different one.
    const redeemerId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    mockGetSessionSafely.mockResolvedValueOnce({
      user: { id: redeemerId, email: 'redeemer@example.com', sessionId: 'session-456' },
      expires: '2099-01-01',
    });

    const redeemReq = buildRequest('http://localhost:3000/api/share/redeem', {
      token: encryptedToken
    });

    const redeemRes = await redeemPOST(redeemReq);
    const redeemData = await redeemRes.json();

    expect(redeemRes.status).toBe(200);
    expect(redeemData.success).toBe(true);
    expect(redeemData.resourceId).toBe(resourceId);
    expect(redeemData.resourceType).toBe('HtmlGeneration');
    
    // The response should contain the resource details needed for the event
  });

  it('should fail with invalid token', async () => {
    const redeemReq = buildRequest('http://localhost:3000/api/share/redeem', {
      token: 'invalid-token'
    });

    const redeemRes = await redeemPOST(redeemReq);
    expect(redeemRes.status).toBe(400); // Or 500 depending on how decryption fails
    // Decryption might throw, catching in route and returning 500 or 400
  });

  it('should issue DailyCallRoom share links without leaking roomUrl in payload and redeem them', async () => {
    const dailyRoomUrl = 'https://pearlos.daily.co/room-123';

    const generateReq = buildRequest('http://localhost:3000/api/share/generate', {
      resourceId: dailyRoomUrl,
      contentType: 'DailyCallRoom',
      role: 'viewer',
      tenantId,
      assistantName: 'pearlos'
    });

    const generateRes = await generatePOST(generateReq);
    const generateData = await generateRes.json();

    expect(generateRes.status).toBe(200);
    expect(generateData.success).toBe(true);

    const linkParts = generateData.link.split('/share/');
    const key = linkParts[1];
    const linkMap = await getLinkMapByKey(key);
    expect(linkMap).toBeDefined();
    const payload = JSON.parse(linkMap!.json);

    // For DailyCallRoom we do not store the raw roomUrl in the payload
    expect(payload.resourceId).toBeUndefined();
    const encryptedToken = payload.token;

    const decrypted = TokenEncryption.decryptToken(encryptedToken);
    expect(decrypted).toBe(generateData.token);

    const redeemReq = buildRequest('http://localhost:3000/api/share/redeem', {
      token: encryptedToken
    });

    const redeemRes = await redeemPOST(redeemReq);
    const redeemData = await redeemRes.json();

    expect(redeemRes.status).toBe(200);
    expect(redeemData.success).toBe(true);
    expect(redeemData.resourceId).toBe(dailyRoomUrl);
    expect(redeemData.resourceType).toBe('DailyCallRoom');
  });
});
