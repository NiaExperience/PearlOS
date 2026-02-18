import type { Metadata } from 'next';
import '@nia/prism/core/css/globals.css'; // Ensure global styles are applied
export const metadata: Metadata = {
  title: 'NiaXP - Google Authentication',
  description: 'Google OAuth Authentication',
};

export default function GoogleAuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en'>
      <body>
        {children}
      </body>
    </html>
  );
}
