import { Shield } from 'lucide-react';
import Link from 'next/link';
import React from 'react';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Administrator Panel</h1>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Link href="/dashboard/admin/global-settings" className="rounded-lg border p-4 hover:bg-accent/30 transition">
          <h2 className="font-semibold mb-1">Global Settings</h2>
          <p className="text-sm text-muted-foreground">Configure platform-wide defaults like login methods.</p>
        </Link>
        <Link href="/dashboard/admin/tenants" className="rounded-lg border p-4 hover:bg-accent/30 transition">
          <h2 className="font-semibold mb-1">Tenants / Users</h2>
          <p className="text-sm text-muted-foreground">Manage tenants, organizations, users & roles.</p>
        </Link>
        <Link href="/dashboard/admin/userProfile" className="rounded-lg border p-4 hover:bg-accent/30 transition">
          <h2 className="font-semibold mb-1">User Profiles</h2>
          <p className="text-sm text-muted-foreground">Review User Profile entries and invite attendees.</p>
        </Link>
        <Link href="/dashboard/admin/personalities" className="rounded-lg border p-4 hover:bg-accent/30 transition">
          <h2 className="font-semibold mb-1">Personalities</h2>
          <p className="text-sm text-muted-foreground">Administer AI personalities across tenants.</p>
        </Link>
        <Link href="/dashboard/admin/functional-prompts" className="rounded-lg border p-4 hover:bg-accent/30 transition">
          <h2 className="font-semibold mb-1">Functional Prompts</h2>
          <p className="text-sm text-muted-foreground">Manage dynamic system prompts with version history.</p>
        </Link>
        <Link href="/dashboard/admin/resource-shares" className="rounded-lg border p-4 hover:bg-accent/30 transition">
          <h2 className="font-semibold mb-1">Resource Shares</h2>
          <p className="text-sm text-muted-foreground">Manage active resource sharing tokens.</p>
        </Link>
        <Link href="/dashboard/admin/link-map" className="rounded-lg border p-4 hover:bg-accent/30 transition">
          <h2 className="font-semibold mb-1">Link Map</h2>
          <p className="text-sm text-muted-foreground">Manage shortened URLs and their targets.</p>
        </Link>
      </div>
    </div>
  );
}
