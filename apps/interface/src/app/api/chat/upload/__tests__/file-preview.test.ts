import JSZip from 'jszip';
import { deflateSync } from 'zlib';

import { extractFilePreview } from '../file-preview';

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

async function docxBuffer(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships" />');
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('chat upload file preview extraction', () => {
  it('extracts selectable text from compressed PDF streams', async () => {
    const preview = await extractFilePreview(
      compressedTextPdf('Katrina PDF says Project Helios is approved'),
      'katrina.pdf',
      'application/pdf',
    );

    expect(preview.kind).toBe('pdf');
    expect(preview.preview).toContain('Project Helios is approved');
    expect(preview.preview).not.toContain('Text extraction was not available');
  });

  it('extracts text from DOCX document XML', async () => {
    const preview = await extractFilePreview(
      await docxBuffer('DOCX launch checklist is readable'),
      'launch-checklist.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    expect(preview.kind).toBe('document');
    expect(preview.preview).toContain('DOCX launch checklist is readable');
  });
});
