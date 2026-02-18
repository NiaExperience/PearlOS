import { DotPattern } from '@interface/components/ui/dot-pattern';
import { cn } from '@interface/lib/utils';
import { Metadata } from 'next';

import '@interface/app/globals.css';

export const metadata: Metadata = {
  title: 'Accept Invite',
  description: 'Activate your account.',
};

export default function AcceptInviteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className='flex h-screen w-full items-center justify-center px-4 dark relative z-10'
      style={{
        backgroundColor: 'var(--theme-background, var(--background))',
        color: 'var(--theme-text-primary, inherit)'
      }}
    >
      {children}

      {/* Same background as login/dashboard - uses CSS variable for 0 0% 3.9% */}
      <div className='w-full h-full fixed inset-0 bg-background z-0 pointer-events-none'>
        <DotPattern
          className={cn(
            '[mask-image:radial-gradient(900px_circle_at_center,white,transparent)]'
          )}
        />
      </div>
    </div>
  );
}
