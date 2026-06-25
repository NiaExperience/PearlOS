// Build manifest endpoint — public, no auth, no cache.
// Used by the post-deploy verifier and by humans confirming which build is live.
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { BUILD_STAMP } from '@interface/build-stamp';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type BuildManifest = {
  codename: string;
  commitSha: string;
  nextBuildId: string;
  buildTime: string;
  packageVersion: string;
};

function loadManifest(): BuildManifest {
  const codename = BUILD_STAMP.codename;
  const commitSha = BUILD_STAMP.commitSha;
  const buildTime = BUILD_STAMP.buildTime;

  let nextBuildId = 'unknown';
  try {
    const buildIdPath = path.join(process.cwd(), '.next', 'BUILD_ID');
    nextBuildId = fs.readFileSync(buildIdPath, 'utf-8').trim();
  } catch {
    try {
      const staticDir = path.join(process.cwd(), '.next', 'static');
      const staticBuildId = fs
        .readdirSync(staticDir)
        .find((entry) => entry.startsWith('build-'));
      if (staticBuildId) {
        nextBuildId = staticBuildId;
      }
    } catch {
      // .next not present in dev mode
    }
  }

  let packageVersion = 'unknown';
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    packageVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version ?? packageVersion;
  } catch {
    // tolerate missing package.json
  }

  return {
    codename,
    commitSha,
    nextBuildId,
    buildTime,
    packageVersion,
  };
}

export async function GET() {
  const manifest = loadManifest();
  return NextResponse.json(
    { ...manifest, servedAt: new Date().toISOString() },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'CDN-Cache-Control': 'no-store',
        'Surrogate-Control': 'no-store',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    },
  );
}
