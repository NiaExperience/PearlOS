const mockResolveInterfaceActorContext = jest.fn();
const mockReadProjects = jest.fn();
const mockWriteProjects = jest.fn();

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

jest.mock('../../lib/store', () => {
  const actual = jest.requireActual('../../lib/store');
  return {
    ...actual,
    readProjects: (...args: unknown[]) => mockReadProjects(...args),
    writeProjects: (...args: unknown[]) => mockWriteProjects(...args),
  };
});

import { POST } from '../route';

function req(body: unknown) {
  return {
    method: 'POST',
    json: async () => body,
  } as Request;
}

describe('/api/launchpad/create-project', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: true,
      actor: {
        userId: 'user-1',
        userEmail: 'sam@example.com',
        tenantId: 'tenant-a',
        tenantRole: 'member',
      },
    });
    mockReadProjects.mockResolvedValue([]);
    mockWriteProjects.mockResolvedValue(undefined);
  });

  it('stamps a play URL for a playable APP creation', async () => {
    const res = await POST(req({ title: 'Client portal', content: 'Build a client portal', type: 'app' }));
    expect(res.status).toBe(200);
    const { project } = await res.json();
    expect(project.playUrl).toBe(`/api/creation/${project.id}/`);
    expect(typeof project.outputPath).toBe('string');
  });

  it('does not imply a play button for a PearlOS change item', async () => {
    const res = await POST(
      req({ title: 'Calmer desktop', content: 'Make my desktop calmer', type: 'pearlos' })
    );
    expect(res.status).toBe(200);
    const { project } = await res.json();
    expect(project.creationType).toBe('PEARLOS');
    expect(project.playUrl).toBeUndefined();
    expect(project.outputPath).toBeUndefined();

    const [written] = mockWriteProjects.mock.calls[0];
    expect(written[0].playUrl).toBeUndefined();
  });
});
