import process from 'node:process';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function Page() {
  const pearlosOnly = (process.env.PEARLOS_ONLY ?? '').toLowerCase() === 'true';
  if (pearlosOnly) {
    return null;
  }

  // Local/dev: keep users in the local app (so GraphQL + DB can be exercised)
  // Note: `headers()` is only available in a server component (this file is one).
  const reqHeaders = await headers();
  const host = reqHeaders.get('host') ?? '';
  const isLocalHost =
    host.startsWith('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.startsWith('0.0.0.0');

  if (process.env.NODE_ENV !== 'production' || isLocalHost) {
    redirect('/pearlos');
  }

  // Production default: redirect the root page to the marketing site
  redirect('https://www.niaxp.com');
}
