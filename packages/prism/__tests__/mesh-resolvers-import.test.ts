import { readdirSync, statSync } from 'fs';
import { join } from 'path';

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  function walk(d: string) {
    let entries: string[] = [];
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      const full = join(d, e);
      let st: any; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && full.endsWith('.ts') && !full.endsWith('.d.ts')) out.push(full);
    }
  }
  walk(dir);
  return out;
}

describe('Mesh resolvers import coverage', () => {
  const base = join(process.cwd(), 'apps/mesh/src/resolvers');
  const files = collectTsFiles(base);
  it('found resolver files', () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const file of files) {
    const rel = file.replace(process.cwd() + '/', '');
    it(`imports ${rel}`, async () => {
      const mod = await import(file);
      expect(mod).toBeTruthy();
    });
  }
});
