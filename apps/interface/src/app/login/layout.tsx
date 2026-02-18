import { DotPattern } from '@interface/components/ui/dot-pattern';
import { cn } from '@interface/lib/utils';
import { Metadata } from 'next';

import '@interface/app/globals.css';

export const metadata: Metadata = {
  title: 'Login',
  description: 'Login to your account.',
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className='flex h-screen w-full items-center justify-center px-4 dark'>
      {children}
      
      {/* Same background as dashboard - uses CSS variable for 0 0% 3.9% */}
      <div className='w-full h-full fixed bg-background'>
        <DotPattern
          className={cn(
            '[mask-image:radial-gradient(900px_circle_at_center,white,transparent)]'
          )}
        />
      </div>
    </div>
  );
} 