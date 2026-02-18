import { readdirSync, statSync } from 'fs';
import { join } from 'path';

function gatherRouteFiles(base: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    const entries = readdirSync(dir);
    for (const e of entries) {
      const full = join(dir, e);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && e === 'route.ts') out.push(full);
    }
  }
  try { walk(base); } catch { /* ignore missing */ }
  return out;
}

const bases = [
  join(process.cwd(), 'apps/interface/src/app/api'),
  join(process.cwd(), 'apps/dashboard/src/app/api'),
];

describe('API route module import smoke coverage', () => {
  const allFiles = bases.flatMap(b => gatherRouteFiles(b));
  // Filter out routes with special import requirements
  const exclusions = [
    'auth/[...nextauth]/route.ts',
    'assistant/dto/route.ts',
    'voice/pipecat/connect/route.ts',
    'voice/pipecat/disconnect/route.ts',
    'personalities/wizard/review/route.ts', // imports generated bot-tools-manifest.json
  ];
  const files = allFiles.filter(file => !exclusions.some(exclusion => file.includes(exclusion)));

  it('found route modules', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = file.replace(process.cwd() + '/', '');
    it(`imports ${rel}`, async () => {
      const mod = await import(file);
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });
  }
});
