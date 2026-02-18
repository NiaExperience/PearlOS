/**
 * Integration-style tests for dashboard personalities API handlers.
 * These mock only the minimal auth + Prism layer, invoking the exported route handlers directly.
 */
import { NextRequest } from 'next/server';
import { GET as LIST, POST as CREATE } from '../src/app/api/personalities/route';
import { GET as DETAIL, PUT as UPDATE, DELETE as REMOVE } from '../src/app/api/personalities/[id]/route';
import { POST as CLONE } from '../src/app/api/personalities/[id]/clone/route';

// Minimal session/auth mocking
jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: jest.fn(async () => ({ user: { id: 'u1' } }))
}));

// In-memory store for personalities keyed by tenant
const memory: Record<string, any[]> = {};

jest.mock('@nia/prism/core/actions/personality.actions', () => {
  const real = jest.requireActual('@nia/prism/core/actions/personality.actions');
  return {
    ...real,
    listPersonalities: async (tenantId: string) => memory[tenantId] || [],
    createPersonality: async (tenantId: string, input: any) => {
      const exists = (memory[tenantId] || []).some(p => p.name && input.name && p.name.toLowerCase() === input.name.toLowerCase());
      if (exists) { const e: any = new Error('Personality name already exists'); e.code = 'NAME_CONFLICT'; throw e; }
      const rec = { _id: `${Date.now()}${Math.random()}`, tenantId, ...input };
      memory[tenantId] = memory[tenantId] || []; memory[tenantId].push(rec); return rec;
    },
    getPersonalityById: async (tenantId: string, id: string) => (memory[tenantId] || []).find(p => p._id === id),
    updatePersonality: async (tenantId: string, id: string, patch: any) => {
      if (patch.name) {
        const exists = (memory[tenantId] || []).some(p => p._id !== id && p.name && p.name.toLowerCase() === patch.name.toLowerCase());
        if (exists) { const e: any = new Error('Personality name already exists'); e.code = 'NAME_CONFLICT'; throw e; }
      }
      const list = memory[tenantId] || []; const idx = list.findIndex(p => p._id === id); if (idx === -1) return undefined; list[idx] = { ...list[idx], ...patch }; return list[idx];
    },
    deletePersonality: async (tenantId: string, id: string) => {
      const list = memory[tenantId] || []; const idx = list.findIndex(p => p._id === id); if (idx === -1) return false; list.splice(idx, 1); return true;
    },
    clonePersonality: async (tenantId: string, id: string) => {
      const src = (memory[tenantId] || []).find(p => p._id === id); if (!src) throw new Error('Source personality not found');
      // simple clone naming similar to real logic
      const names = (memory[tenantId] || []).map(p => p.name || '');
      let base = src.name || 'New Personality';
      const exists = (n: string) => names.some(nn => nn.toLowerCase() === n.toLowerCase());
      if (!exists(base)) base = base; else {
        let i = 1; let candidate = `${base} ${i}`; while (exists(candidate)) { i += 1; candidate = `${base} ${i}`; } base = candidate;
      }
      const rec = { ...src, _id: `${Date.now()}${Math.random()}`, name: base };
      memory[tenantId].push(rec); return rec;
    }
  };
});

function makeReq(url: string, method: string = 'GET', body?: any): NextRequest {
  // @ts-ignore constructing minimal NextRequest-compatible object for handler
  return new NextRequest(new URL(url, 'http://localhost'), { method, body: body ? JSON.stringify(body) : undefined });
}

const TENANT = 't-api';

describe('dashboard personalities API routes', () => {
  test('create and list personalities', async () => {
    const createRes = await CREATE(makeReq(`/api/personalities`, 'POST', { tenantId: TENANT, content: { name: 'Alpha' } }) as any);
    expect(createRes.status).toBe(200);
    const listRes = await LIST(makeReq(`/api/personalities?tenantId=${TENANT}`) as any);
    const data = await listRes.json();
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.find((p: any) => p.name === 'Alpha')).toBeTruthy();
  });

  test('reject duplicate create with 409', async () => {
    await CREATE(makeReq(`/api/personalities`, 'POST', { tenantId: TENANT, content: { name: 'DupCreate' } }) as any);
    const dup = await CREATE(makeReq(`/api/personalities`, 'POST', { tenantId: TENANT, content: { name: 'DupCreate' } }) as any);
    expect(dup.status).toBe(409);
  });

  test('update conflict returns 409', async () => {
    const a = await CREATE(makeReq(`/api/personalities`, 'POST', { tenantId: TENANT, content: { name: 'A' } }) as any); const aData = await a.json();
    const b = await CREATE(makeReq(`/api/personalities`, 'POST', { tenantId: TENANT, content: { name: 'B' } }) as any); const bData = await b.json();
    const conflict = await UPDATE(makeReq(`/api/personalities/${bData.item._id}?tenantId=${TENANT}`, 'PUT', { content: { name: 'A' } }) as any, { params: { id: bData.item._id } });
    expect(conflict.status).toBe(409);
  });

  test('clone endpoint creates new personality', async () => {
    const base = await CREATE(makeReq(`/api/personalities`, 'POST', { tenantId: TENANT, content: { name: 'Base' } }) as any); const baseData = await base.json();
    const clone = await CLONE(makeReq(`/api/personalities/${baseData.item._id}/clone?tenantId=${TENANT}`, 'POST') as any, { params: { id: baseData.item._id } });
    expect(clone.status).toBe(200);
    const clonePayload = await clone.json();
    expect(clonePayload.item._id).not.toBe(baseData.item._id);
  });

  test('delete personality', async () => {
    const createRes = await CREATE(makeReq(`/api/personalities`, 'POST', { tenantId: TENANT, content: { name: 'ToDelete' } }) as any); const cData = await createRes.json();
    const del = await REMOVE(makeReq(`/api/personalities/${cData.item._id}?tenantId=${TENANT}`, 'DELETE') as any, { params: { id: cData.item._id } });
    expect(del.status).toBe(200);
  });
});
