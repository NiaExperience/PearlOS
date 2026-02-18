import fs from 'fs';
import path from 'path';

const manifestPath = path.join(__dirname, '../src/component-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

function walk(dir: string, filelist: string[] = []): string[] {
  fs.readdirSync(dir).forEach(file => {
    const filepath = path.join(dir, file);
    if (fs.statSync(filepath).isDirectory()) {
      filelist = walk(filepath, filelist);
    } else if (file.endsWith('.tsx')) {
      // Normalize to manifest-style relative path
      const rel = path.relative(path.join(__dirname, '..'), filepath).replace(/\\/g, '/');
      filelist.push(rel);
    }
  });
  return filelist;
}

// NOTE: if this test fails, it likely means you added a new component to the
// interface core components.  We encourage you to consider any new bits as
// features, and just stick them in a features/YourFeature folder.  If you 
// believe your component is core to the app, go ahead and update the manifest.
describe('Component manifest enforcement', () => {
  it('should match the set of .tsx components in src/components', () => {
    const base = path.join(__dirname, '..');
    const componentDirs = [
      'components',
      'components/anim',
      'components/debug',
      'components/ui'
    ];
    const allComponents = componentDirs.flatMap(dir =>
      fs.existsSync(path.join(base, dir)) ?
        walk(path.join(base, dir)).map(f => path.relative(base, f).replace(/\\/g, '/')) : []
    );
    const manifestSet = new Set(manifest.components);
    const actualSet = new Set(allComponents);
    const missing = [...manifestSet as Set<string>].filter((x: string) => !actualSet.has(x));
    const added = [...actualSet].filter((x: string) => !manifestSet.has(x));
    expect({ missing, added }).toEqual({ missing: [], added: [] });
  });
});
