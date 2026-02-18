import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';
import { UserActions } from '@nia/prism/core/actions';
import { v4 as uuidv4 } from 'uuid';

const exclusions = [
  'auth/[...nextauth]/route.ts',
  'assistant/dto/route.ts',
];

// Speed-up: mock HTML generation actions to avoid expensive real work in route handlers
jest.mock('@interface/features/HtmlGeneration/actions/html-generation-actions', () => {
  const build = () => ({
    id: 'mock-gen',
    title: 'Mock HTML Generation',
    htmlContent: '<!DOCTYPE html><html><head><title>Mock</title></head><body>Mock</body></html>',
    contentType: 'text/html',
    metadata: { aiProvider: 'mock' }
  });
  return {
    __esModule: true,
    createHtmlGeneration: jest.fn().mockImplementation(async () => build()),
    getHtmlGeneration: jest.fn().mockImplementation(async () => build()),
    listHtmlGenerations: jest.fn().mockImplementation(async () => [build()])
  };
});

// Also mock the HtmlGeneration barrel used by some route files (e.g., routes/[id]/route.ts)
jest.mock('@interface/features/HtmlGeneration', () => {
  const buildContent = () => ({
    id: 'mock-content-id',
    title: 'Mock Content',
    htmlContent: '<!DOCTYPE html><html><head><title>Mock</title></head><body>Mock</body></html>',
    contentType: 'text/html',
    metadata: { aiProvider: 'mock' }
  });
  const buildGen = () => ({
    id: 'mock-gen',
    title: 'Mock HTML Generation',
    htmlContent: '<!DOCTYPE html><html><head><title>Mock</title></head><body>Mock</body></html>',
    contentType: 'text/html',
    metadata: { aiProvider: 'mock' }
  });
  return {
    __esModule: true,
    // Actions consumed by HTML content routes
    createHtmlContent: jest.fn().mockResolvedValue(buildContent()),
    findHtmlContentById: jest.fn().mockResolvedValue(buildContent()),
    listHtmlContent: jest.fn().mockResolvedValue({ total: 1, items: [buildContent()] }),
    updateHtmlContent: jest.fn().mockResolvedValue(buildContent()),
    deleteHtmlContent: jest.fn().mockResolvedValue(true),
    // Generation actions (in case barrel re-exports)
    createHtmlGeneration: jest.fn().mockResolvedValue(buildGen()),
    getHtmlGeneration: jest.fn().mockResolvedValue(buildGen()),
    listHtmlGenerations: jest.fn().mockResolvedValue([buildGen()])
  };
});

function collectRouteFiles(base: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (e === 'route.ts') {
        if (exclusions.some(ex => full.includes(ex))) continue;
        out.push(full);
      }
    }
  }
  walk(base);
  return out;
}

function buildReq(url: string, method: string, body?: any, headers: Record<string, string> = {}) {
  const init: any = { method, headers: { 'content-type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(url, init);
}

export function runInterfaceRouteShard(shardIndex: number, routesPerShard = 10) {
  const base = join(process.cwd(), 'apps/interface/src/app/api');
  const allFiles = collectRouteFiles(base);
  const start = (shardIndex) * routesPerShard;
  const files = allFiles.slice(start, start + routesPerShard);

  describe(`interface route basic invocation (shard ${shardIndex})`, () => {
    let testUser: any;

    beforeEach(async () => {
      process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-length-1234xyz').toString('base64');
      testUser = await UserActions.createUser({ name: `IfaceUser-${uuidv4()}`, email: `iface-user-${uuidv4()}@example.com`, password: 'Pass1234!!' } as any);
      expect(testUser).toBeTruthy();
      expect(testUser._id).toBeTruthy();
    });

    if (files.length === 0) {
      it('placeholder - no interface routes discovered in this shard', () => {
        expect(true).toBe(true);
      });
      return;
    }

    for (const file of files) {
      const rel = file.replace(process.cwd() + '/', '');
      test.concurrent(`invokes handlers in ${rel}`, async () => {
        const mod: any = await import(file);
        const urlBase = 'http://localhost/' + rel.replace('apps/interface/src/app/', '').replace(/route.ts$/, '');
        const dynamicSegmentPath = rel.replace('apps/interface/src/app/api/', '').replace(/route.ts$/, '');
        const paramMatches = dynamicSegmentPath.match(/\[\.\.\.(.+?)\]|\[(.+?)\]/g) || [];
        const params: Record<string, string> = {};
        for (const m of paramMatches) {
          const name = m.replace(/[[\]\.\.\.]/g, '');
          if (name.toLowerCase().includes('tenant')) params[name] = 'tenant-test';
          else if (name.toLowerCase().includes('user')) params[name] = 'user-test';
          else if (name.toLowerCase().includes('id')) params[name] = 'test-id';
          else params[name] = 'param';
        }
        const ctx = { params } as any;

        // Use a safe fallback for the header to avoid throwing before the request is made
        const userIdHeader = (testUser && testUser._id) ? testUser._id : 'user123';
        const baseHeaders = { 'x-test-user-id': userIdHeader, 'x-test-google-access-token': 'test-access-token' } as Record<string, string>;

        if (mod.GET) {
          try {
            const res = await mod.GET(buildReq(urlBase, 'GET', undefined, baseHeaders) as any, ctx);
            expect(res.status).toBeGreaterThanOrEqual(200);
          } catch (e) { expect(e).toBeFalsy(); }
        }
        if (mod.POST) {
          try {
            const res = await mod.POST(buildReq(urlBase, 'POST', { ping: true }, baseHeaders) as any, ctx);
            expect(res.status).toBeGreaterThanOrEqual(200);
          } catch (e) { expect(e).toBeFalsy(); }
        }
        if (mod.DELETE) {
          try {
            const res = await mod.DELETE(buildReq(urlBase, 'DELETE', undefined, baseHeaders) as any, ctx);
            expect(res.status).toBeGreaterThanOrEqual(200);
          } catch (e) { expect(e).toBeFalsy(); }
        }
      });
    }
  });
}

// Only register tests for shard 1 when this file itself is the active test file.
try {
  if (expect.getState().testPath === __filename) {
    runInterfaceRouteShard(0);
  }
} catch { /* ignore if not in Jest context */ }