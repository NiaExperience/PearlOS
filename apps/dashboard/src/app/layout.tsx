import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '../components/theme-provider';
import { Toaster } from '../components/ui/toaster';
import { AuthProvider } from '../providers/auth-provider';
import { authConfig } from '../lib/next-auth-config';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-poppins',
});

export const metadata: Metadata = {
  title: 'NiaXP Dashboard',
  description: 'NiaXP Dashboard - Manage your assistants and tools',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reference authConfig to ensure it's not tree-shaken
  const basePath = authConfig.basePath;
  
  return (
    <html lang='en' className={`${poppins.variable} font-sans`} suppressHydrationWarning>
      <body>
        <AuthProvider>
          <ThemeProvider
            attribute='class'
            defaultTheme='system'
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <Toaster />
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
