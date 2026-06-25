import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { deflateSync } from 'zlib';

import { POST } from '../route';

jest.mock('@interface/lib/api-auth', () => ({
  requireAuth: jest.fn().mockResolvedValue(null),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: jest.fn().mockResolvedValue({
    ok: true,
    actor: {
      userId: 'user-1',
      userEmail: 'katrina@example.com',
      userName: 'Katrina Sheetz',
      tenantId: 'tenant-a',
      tenantRole: 'member',
    },
  }),
}));

function compressedTextPdf(text: string): Buffer {
  const stream = Buffer.from(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`, 'latin1');
  const compressed = deflateSync(stream);
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length '),
    Buffer.from(String(compressed.length)),
    Buffer.from(' /Filter /FlateDecode >>\nstream\n'),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF\n'),
  ]);
}

describe('/api/chat/upload', () => {
  let userRoot: string;

  beforeEach(async () => {
    userRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pearl-user-root-'));
    process.env.PEARLOS_USER_ROOT = userRoot;
  });

  afterEach(async () => {
    delete process.env.PEARLOS_USER_ROOT;
    await fs.rm(userRoot, { recursive: true, force: true });
  });

  it('stores PDFs in FileSpace and returns extracted text context', async () => {
    const form = new FormData();
    const pdf = compressedTextPdf('Katrina PDF says the vendor renewal date is July 1');
    form.append('file', new File([pdf], 'Katrina Renewal.pdf', { type: 'application/pdf' }));

    const response = await POST({ formData: async () => form } as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.path).toContain(path.join(userRoot, 'tenant-a', 'user-1', 'Documents', 'Attachments'));
    expect(data.fileSpacePath).toMatch(/^Attachments\/\d{4}-\d{2}-\d{2}\/.+Katrina_Renewal\.pdf$/);
    expect(data.attachmentContext).toContain('Katrina PDF says the vendor renewal date is July 1');
    expect(data.attachmentContext).toContain(`FileSpace path: ${data.fileSpacePath}`);

    const stored = await fs.readFile(path.join(userRoot, 'tenant-a', 'user-1', 'Documents', data.fileSpacePath));
    expect(stored.equals(pdf)).toBe(true);
  });
});
