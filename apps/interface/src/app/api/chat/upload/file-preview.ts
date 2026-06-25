import path from 'path';
import { inflateSync } from 'zlib';

const MAX_PREVIEW_CHARS = 24000;
const MAX_STREAM_SCAN_BYTES = 12 * 1024 * 1024;

export interface FilePreview {
  kind: string;
  preview: string;
}

export interface AttachmentContextRecord {
  originalName: string;
  mime: string;
  bytes: number;
  path: string;
  fileSpacePath?: string;
  kind: string;
  sha256: string;
  preview: string;
}

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.sh',
  '.sql',
  '.toml',
  '.ini',
  '.cfg',
  '.env',
  '.log',
]);

function hasPdfSignature(buf: Buffer): boolean {
  return buf.subarray(0, 8).toString('latin1').startsWith('%PDF-');
}

function isPdfFile(buf: Buffer, filename: string, mime: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const lowerMime = (mime || '').toLowerCase();
  return ext === '.pdf' || lowerMime === 'application/pdf' || hasPdfSignature(buf);
}

function truncatePreview(text: string, maxChars = MAX_PREVIEW_CHARS): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\0/g, '')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function usefulText(text: string): boolean {
  const cleaned = normalizeExtractedText(text);
  if (cleaned.length < 2 || !/[A-Za-z0-9]/.test(cleaned)) return false;
  const printable = cleaned.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '');
  return printable.length / Math.max(cleaned.length, 1) > 0.7;
}

function utf8Preview(buf: Buffer): string {
  return truncatePreview(normalizeExtractedText(buf.toString('utf8')));
}

function stripHtmlPreview(buf: Buffer): string {
  const text = buf
    .toString('utf8')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return truncatePreview(normalizeExtractedText(decodeXmlEntities(text)));
}

function decodeUtf16be(bytes: number[]): string {
  const chars: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    chars.push((bytes[i] << 8) | bytes[i + 1]);
  }
  return String.fromCharCode(...chars);
}

function decodePdfByteString(bytes: number[]): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16be(bytes.slice(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return Buffer.from(bytes.slice(2)).toString('utf16le');
  }
  return Buffer.from(bytes).toString('latin1');
}

function decodePdfLiteral(raw: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') {
      bytes.push(raw.charCodeAt(i) & 0xff);
      continue;
    }
    const next = raw[++i];
    if (!next) break;
    if (next === 'n') bytes.push(0x0a);
    else if (next === 'r') bytes.push(0x0d);
    else if (next === 't') bytes.push(0x09);
    else if (next === 'b') bytes.push(0x08);
    else if (next === 'f') bytes.push(0x0c);
    else if (next === '\r' || next === '\n') {
      if (next === '\r' && raw[i + 1] === '\n') i += 1;
    } else if (/[0-7]/.test(next)) {
      let octal = next;
      for (let j = 0; j < 2 && /[0-7]/.test(raw[i + 1] || ''); j += 1) {
        octal += raw[++i];
      }
      bytes.push(parseInt(octal, 8) & 0xff);
    } else {
      bytes.push(next.charCodeAt(0) & 0xff);
    }
  }
  return normalizeExtractedText(decodePdfByteString(bytes));
}

function extractPdfLiteralStrings(data: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] !== '(') continue;
    let depth = 1;
    let escaped = false;
    let raw = '';
    for (let j = i + 1; j < data.length; j += 1) {
      const ch = data[j];
      if (escaped) {
        raw += `\\${ch}`;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '(') {
        depth += 1;
        raw += ch;
        continue;
      }
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          const decoded = decodePdfLiteral(raw);
          if (usefulText(decoded)) values.push(decoded);
          i = j;
          break;
        }
        raw += ch;
        continue;
      }
      raw += ch;
    }
  }
  return values;
}

function decodePdfHex(raw: string): string {
  const hex = raw.replace(/\s+/g, '');
  if (hex.length < 4 || hex.length % 2 !== 0) return '';
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return normalizeExtractedText(decodePdfByteString(bytes));
}

function extractPdfHexStrings(data: string): string[] {
  const values: string[] = [];
  for (const match of data.matchAll(/(?<!<)<([0-9A-Fa-f\s]{4,})>(?!>)/g)) {
    const decoded = decodePdfHex(match[1]);
    if (usefulText(decoded)) values.push(decoded);
  }
  return values;
}

function pdfChunks(buf: Buffer): string[] {
  const raw = buf.subarray(0, MAX_STREAM_SCAN_BYTES).toString('latin1');
  const chunks = [raw];
  let cursor = 0;
  while (cursor < raw.length) {
    const streamStart = raw.indexOf('stream', cursor);
    if (streamStart === -1) break;
    let dataStart = streamStart + 'stream'.length;
    if (raw[dataStart] === '\r' && raw[dataStart + 1] === '\n') dataStart += 2;
    else if (raw[dataStart] === '\n' || raw[dataStart] === '\r') dataStart += 1;

    const streamEnd = raw.indexOf('endstream', dataStart);
    if (streamEnd === -1) break;
    const descriptor = raw.slice(Math.max(0, streamStart - 1200), streamStart);
    const streamBytes = buf.subarray(dataStart, streamEnd);
    chunks.push(streamBytes.toString('latin1'));
    if (/\/(?:Filter\s*)?(?:\[[^\]]*)?\/FlateDecode\b/.test(descriptor)) {
      try {
        chunks.push(inflateSync(streamBytes).toString('latin1'));
      } catch {
        try {
          chunks.push(inflateSync(streamBytes.subarray(0, Math.max(0, streamBytes.length - 1))).toString('latin1'));
        } catch {
          // Keep the raw stream scan; malformed compressed streams should not break upload.
        }
      }
    }
    cursor = streamEnd + 'endstream'.length;
  }
  return chunks;
}

function extractPdfTextPreviewFallback(buf: Buffer): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const chunk of pdfChunks(buf)) {
    for (const value of [...extractPdfLiteralStrings(chunk), ...extractPdfHexStrings(chunk)]) {
      const cleaned = normalizeExtractedText(value);
      const key = cleaned.toLowerCase();
      if (!cleaned || seen.has(key)) continue;
      seen.add(key);
      lines.push(cleaned);
      if (lines.join('\n').length >= MAX_PREVIEW_CHARS) {
        return truncatePreview(lines.join('\n'));
      }
    }
  }
  return truncatePreview(lines.join('\n'));
}

async function extractPdfTextWithParser(buf: Buffer): Promise<string> {
  let parser: { getText: () => Promise<{ text?: string }>; destroy?: () => Promise<void> | void } | null = null;
  try {
    const { PDFParse } = await import('pdf-parse');
    parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    const text = truncatePreview(normalizeExtractedText(result.text || ''));
    return usefulText(text) ? text : '';
  } catch {
    return '';
  } finally {
    await parser?.destroy?.();
  }
}

export async function extractPdfTextPreview(buf: Buffer): Promise<string> {
  const parsed = await extractPdfTextWithParser(buf);
  if (parsed) return parsed;
  return extractPdfTextPreviewFallback(buf);
}

function legacyDocPreview(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const parts: string[] = [];
  for (const match of raw.matchAll(/[\x09\x0a\x0d\x20-\x7e]{4,}/g)) {
    const text = normalizeExtractedText(match[0]);
    if (!text || /^(Root Entry|WordDocument|SummaryInformation|DocumentSummaryInformation)$/.test(text)) continue;
    if (usefulText(text)) parts.push(text);
    if (parts.join('\n').length >= MAX_PREVIEW_CHARS) break;
  }
  return truncatePreview(parts.join('\n'));
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function textFromOfficeXml(xml: string): string {
  const withBreaks = xml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<\/text:p>/g, '\n');
  const parts: string[] = [];
  for (const match of withBreaks.matchAll(/<(?:w:t|a:t|text:span|text:p)[^>]*>([\s\S]*?)<\/(?:w:t|a:t|text:span|text:p)>/g)) {
    parts.push(decodeXmlEntities(match[1].replace(/<[^>]+>/g, ' ')));
  }
  return normalizeExtractedText(parts.join(' '));
}

async function zipXmlPreview(buf: Buffer, filename: string, kind: 'docx' | 'pptx' | 'odt'): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  let targets: string[] = [];
  if (kind === 'docx') {
    targets = [
      'word/document.xml',
      ...names.filter((name) => /^word\/(?:header|footer|footnotes|endnotes)\d*\.xml$/.test(name)).sort(),
    ];
  } else if (kind === 'pptx') {
    targets = names
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));
  } else {
    targets = ['content.xml'];
  }

  const sections: string[] = [];
  for (const name of targets) {
    const file = zip.file(name);
    if (!file) continue;
    const text = textFromOfficeXml(await file.async('text'));
    if (text) sections.push(kind === 'pptx' ? `## ${path.basename(name, '.xml')}\n${text}` : text);
    if (sections.join('\n\n').length >= MAX_PREVIEW_CHARS) break;
  }
  const label = kind === 'docx' ? 'Word document' : kind === 'pptx' ? 'PowerPoint deck' : 'OpenDocument text';
  return truncatePreview(`${label} preview for ${filename}\n\n${sections.join('\n\n')}`.trim());
}

async function spreadsheetPreview(buf: Buffer, filename: string): Promise<string> {
  const xlsx = await import('xlsx');
  const workbook = xlsx.read(buf, { type: 'buffer', cellDates: true });
  const sections: string[] = [];
  for (const sheetName of workbook.SheetNames.slice(0, 6)) {
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_csv(sheet).split(/\r?\n/).slice(0, 80).join('\n');
    sections.push(`## Sheet: ${sheetName}\n${rows}`);
  }
  return truncatePreview(`Spreadsheet preview for ${filename}\n\n${sections.join('\n\n')}`);
}

export async function extractFilePreview(buf: Buffer, filename: string, mime: string): Promise<FilePreview> {
  const ext = path.extname(filename).toLowerCase();
  const lowerMime = (mime || '').toLowerCase();
  if (isPdfFile(buf, filename, mime)) {
    const preview = await extractPdfTextPreview(buf);
    return {
      kind: 'pdf',
      preview: preview || 'PDF stored successfully. No selectable text was found in the lightweight preview; treat it as a scanned/image PDF and route to OCR or vision tooling instead of saying it cannot be read.',
    };
  }
  if (lowerMime.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) {
    if (ext === '.html' || ext === '.htm' || lowerMime.includes('html')) {
      return { kind: 'text', preview: stripHtmlPreview(buf) };
    }
    return { kind: 'text', preview: utf8Preview(buf) };
  }
  if (ext === '.xlsx' || ext === '.xls' || ext === '.ods' || lowerMime.includes('spreadsheet') || lowerMime.includes('opendocument.spreadsheet')) {
    return { kind: 'spreadsheet', preview: await spreadsheetPreview(buf, filename) };
  }
  if (ext === '.docx' || lowerMime.includes('wordprocessingml.document')) {
    return { kind: 'document', preview: await zipXmlPreview(buf, filename, 'docx') };
  }
  if (ext === '.pptx' || lowerMime.includes('presentationml.presentation')) {
    return { kind: 'presentation', preview: await zipXmlPreview(buf, filename, 'pptx') };
  }
  if (ext === '.odt' || lowerMime.includes('opendocument.text')) {
    return { kind: 'document', preview: await zipXmlPreview(buf, filename, 'odt') };
  }
  if (ext === '.doc') {
    const preview = legacyDocPreview(buf);
    return {
      kind: 'document',
      preview: preview || 'Word .doc stored successfully. No readable text was found in the lightweight preview; route to document conversion tooling instead of saying it cannot be read.',
    };
  }
  if (lowerMime.startsWith('image/')) {
    return { kind: 'image', preview: 'Image stored successfully. PearlOS sends the image pixels with the chat turn for vision inspection when attached in web chat.' };
  }
  if (lowerMime.startsWith('video/') || lowerMime.startsWith('audio/')) {
    return { kind: lowerMime.startsWith('video/') ? 'video' : 'audio', preview: `${mime} stored successfully with metadata. Route to media transcription or scene extraction tooling when the user asks about its contents.` };
  }
  return { kind: 'binary', preview: 'File stored successfully. No lightweight text preview was extracted; route to the appropriate file-specific tool instead of saying it cannot be read.' };
}

export function buildAttachmentContext(record: AttachmentContextRecord): string {
  return [
    '[User attached a file]',
    `Filename: ${record.originalName}`,
    `MIME: ${record.mime}`,
    `Size: ${record.bytes} bytes`,
    `Kind: ${record.kind}`,
    `SHA256: ${record.sha256}`,
    `Stored path: ${record.path}`,
    record.fileSpacePath ? `FileSpace path: ${record.fileSpacePath}` : null,
    record.preview ? `Extracted preview:\n${record.preview}` : 'Extracted preview: route to the appropriate file reader; do not say the file cannot be read.',
  ].filter(Boolean).join('\n');
}
