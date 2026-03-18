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

import { LabModeBanner } from '@interface/components/LabModeBanner';
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
      <head>
        <link rel="preload" href="/backgrounds/home-sunset.png" as="image" />
        <link rel="preload" href="/backgrounds/desktop-forest.png" as="image" />
        {/* Dynamic page title with EST time + date + build ID */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var BUILD_ID = '075d4794-restart-fix';
                function updateTitle() {
                  var now = new Date();
                  var est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                  var month = (est.getMonth()+1).toString().padStart(2,'0');
                  var day = est.getDate().toString().padStart(2,'0');
                  var h = est.getHours().toString().padStart(2,'0');
                  var m = est.getMinutes().toString().padStart(2,'0');
                  document.title = 'PearlOS — ' + BUILD_ID + ' | ' + month + '/' + day + ' ' + h + ':' + m + ' EST';
                }
                updateTitle();
                // Re-assert after hydration overwrites title, then settle to 30s
                setTimeout(updateTitle, 1000);
                setTimeout(updateTitle, 3000);
                setTimeout(updateTitle, 5000);
                setTimeout(updateTitle, 10000);
                setInterval(updateTitle, 30000);
              })();
            `,
          }}
        />
        {/* Service worker cleanup - unregister any legacy service workers */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(function(registrations) {
                  for (let registration of registrations) {
                    registration.unregister().then(function(success) {
                      if (success) console.log('Unregistered legacy service worker');
                    });
                  }
                });
              }
            `,
          }}
        />
      </head>
      <body className={inter.className} suppressHydrationWarning>
        <Providers>
          <LabModeBanner />
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
