import { isFeatureEnabled } from '@nia/features';

import { GlobalHtmlGenerationStatus } from '@interface/features/HtmlGeneration/components/GlobalHtmlGenerationStatus';
import { ActiveJobsWidget } from '@interface/features/ActiveJobs/components/ActiveJobsWidget';
import 'reflect-metadata';
import './globals.css';

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import { Toaster } from '@interface/components/ui/toaster';
import { DisableTabNavigation } from '@interface/components/disable-tab-navigation';
import { ErrorBoundary } from '@interface/components/ErrorBoundary';
// Rive avatar removed — GIF only per Blair directive 2026-02-24

import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'PearlOS',
  description: 'PearlOS — Your AI companion desktop',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning on <html> and <body>: browser extensions (e.g. password
  // managers, translators) can inject attributes/elements, causing hydration mismatches
  // on mobile Safari and other browsers. This is a standard Next.js safety net.
  
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <Providers>
          <DisableTabNavigation />
          <Toaster />
          <GlobalHtmlGenerationStatus />
          <ActiveJobsWidget />
          {children}
          {/* GIF-based avatar is rendered inline in ChatMode.tsx */}
        </Providers>
      </body>
    </html>
  );
}
