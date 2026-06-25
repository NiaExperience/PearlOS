import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID, createHash } from 'crypto';
import { requireAuth } from '@interface/lib/api-auth';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import { buildAttachmentContext, extractFilePreview } from './file-preview';

const MAX_BYTES = Number(process.env.CHAT_UPLOAD_MAX_BYTES || 50 * 1024 * 1024);

function userRootBase(): string {
  return process.env.PEARLOS_USER_ROOT || '/workspace/user';
}

function sanitizeSegment(value: string): string {
  const safe = (value || 'unknown').trim().replace(/[^A-Za-z0-9_-]+/g, '_');
  return safe.slice(0, 160) || 'unknown';
}

function sanitizeFilename(name: string): string {
  const trimmed = (name || 'upload').trim().replace(/[\\/]+/g, '_');
  const safe = trimmed.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, '_');
  return safe.slice(0, 140) || 'upload';
}

function todayDir(): string {
  return new Date().toISOString().slice(0, 10);
}

function toFileSpaceRelative(fullPath: string, documentsRoot: string): string {
  return path.relative(documentsRoot, fullPath).split(path.sep).filter(Boolean).join('/');
}

function decodeDataUrl(dataUrl: string): { buf: Buffer; mime: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buf: Buffer.from(match[2], 'base64') };
}

function hasPdfSignature(buf: Buffer): boolean {
  return buf.subarray(0, 8).toString('latin1').startsWith('%PDF-');
}

function effectiveMimeForUpload(filename: string, rawMime: string, buf: Buffer, kind: string): string {
  const ext = path.extname(filename).toLowerCase();
  const lowerMime = (rawMime || '').toLowerCase();
  if (kind === 'pdf' || ext === '.pdf' || hasPdfSignature(buf)) return 'application/pdf';
  if (kind === 'document' && ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (kind === 'presentation' && ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (kind === 'spreadsheet' && ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (kind === 'document' && ext === '.odt') return 'application/vnd.oasis.opendocument.text';
  if (kind === 'spreadsheet' && ext === '.ods') return 'application/vnd.oasis.opendocument.spreadsheet';
  if (kind !== 'image' && lowerMime.startsWith('image/')) return 'application/octet-stream';
  return rawMime || 'application/octet-stream';
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const form = await req.formData();
    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId: form.get('tenantId') ?? form.get('tenant_id'),
    });
    if (!actorResult.ok) return actorResult.response;

    const tenantId = sanitizeSegment(actorResult.actor.tenantId);
    const userId = sanitizeSegment(actorResult.actor.userId);
    const uploadedFile = form.get('file');
    const dataUrl = form.get('imageDataUrl');
    const rawName = form.get('imageName') || form.get('filename');

    let buf: Buffer;
    let mime: string;
    let originalName: string;

    if (uploadedFile instanceof File) {
      buf = Buffer.from(await uploadedFile.arrayBuffer());
      mime = uploadedFile.type || 'application/octet-stream';
      originalName = uploadedFile.name || 'upload';
    } else if (typeof dataUrl === 'string') {
      const decoded = decodeDataUrl(dataUrl);
      if (!decoded) return NextResponse.json({ error: 'imageDataUrl malformed' }, { status: 400 });
      buf = decoded.buf;
      mime = decoded.mime;
      originalName = typeof rawName === 'string' ? rawName : 'upload';
    } else {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }

    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ error: `file exceeds ${MAX_BYTES} bytes` }, { status: 413 });
    }

    const safeName = sanitizeFilename(originalName);
    const documentsRoot = path.join(userRootBase(), tenantId, userId, 'Documents');
    const dir = path.join(documentsRoot, 'Attachments', todayDir());
    await fs.mkdir(dir, { recursive: true });
    const finalName = `${randomUUID()}-${safeName}`;
    const finalPath = path.join(dir, finalName);
    await fs.writeFile(finalPath, buf);

    const sha256 = createHash('sha256').update(buf).digest('hex');
    const rawMime = mime;
    const extracted = await extractFilePreview(buf, originalName, rawMime);
    mime = effectiveMimeForUpload(originalName, rawMime, buf, extracted.kind);
    const fileSpacePath = toFileSpaceRelative(finalPath, documentsRoot);
    const record = {
      id: randomUUID(),
      tenantId,
      userId,
      originalName,
      filename: finalName,
      path: finalPath,
      fileSpacePath,
      mime,
      rawMime: rawMime !== mime ? rawMime : undefined,
      bytes: buf.length,
      sha256,
      kind: extracted.kind,
      preview: extracted.preview,
      createdAt: new Date().toISOString(),
    };

    await fs.appendFile(path.join(documentsRoot, 'Attachments', 'attachments.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');

    return NextResponse.json({
      ok: true,
      ...record,
      attachmentContext: buildAttachmentContext(record),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: `upload failed: ${msg}` }, { status: 500 });
  }
}
