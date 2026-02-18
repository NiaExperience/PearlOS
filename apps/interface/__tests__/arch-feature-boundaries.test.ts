import fs from 'fs';
import path from 'path';

// NOTE: if this test fails, it likely means you added a new folder to your
// feature folder.  We like to keep it clean, so if your work fits into one
// of the below, move it.  Otherwise, if compelled, update the set of allowed
// subfolders.
describe('Feature folder canonical layout enforcement', () => {
  const base = path.join(__dirname, '../src/features');
  // Allowed subfolders for a feature
  const allowedSubfolders = new Set([
    'components',
    'actions',
    'events',
    'routes',
    'lib',
    'services',
    'scripts',
    'docs',
    'examples',
    'state',
    'styles',
    'types',
    'hooks',
    '__tests__',
  ]);
  const allowedFiles = new Set(['index.ts', 'service.ts', 'definition.ts']);

  function checkFeatureFolder(feature: string, featurePath: string) {
    const entries = fs.readdirSync(featurePath);
    const problems: string[] = []; // Explicitly typed as an array of strings
    for (const entry of entries) {
      const entryPath = path.join(featurePath, entry);
      if (fs.statSync(entryPath).isDirectory()) {
        if (!allowedSubfolders.has(entry)) {
          problems.push(`Non-canonical subfolder: features/${feature}/${entry}`);
        }
      } else {
        if (!allowedFiles.has(entry)) {
          // Allow arbitrary files in routes/
          if (entry.endsWith('.ts')) {
            problems.push(`Stray file: features/${feature}/${entry}`);
          }
        }
      }
    }
    if (problems.length > 0) {
      throw new Error('Feature folder layout violations:\n' + problems.join('\n'));
    }
  }

  for (const feature of fs.readdirSync(base)) {
    const featurePath = path.join(base, feature);
    if (!fs.statSync(featurePath).isDirectory()) continue;
    it(`should have only canonical subfolders/files in features/${feature}`, () => {
      checkFeatureFolder(feature, featurePath);
    });
  }
});
