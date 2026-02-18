'use client';

import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect } from 'react';

import { useToast } from '@dashboard/hooks/use-toast';

import { Button } from '../../components/ui/button';
import {
    Card, CardContent, CardDescription, CardHeader, CardTitle
} from '../../components/ui/card';

export default function UnauthorizedPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  useEffect(() => {
    // If no session, redirect to login
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Show loading while checking session
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  // If no session, don't render anything (will redirect)
  if (!session) {
    return null;
  }


  const handleSignOut = async () => {
    try {
      const response = await fetch('/api/auth/signout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        // Also call NextAuth's signOut to clear client-side state
        await signOut({ redirect: false });
        
        toast({
          title: "Signed out",
          description: "You have been successfully signed out.",
        });
        // Redirect to login page
        router.push('/login');
        // Force a page reload to clear any client-side state
        router.refresh();
      } else {
        throw new Error('Sign-out failed');
      }
    } catch (error) {
      toast({
        title: "Sign out error",
        description: "There was an error signing you out.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Access Denied</CardTitle>
          <CardDescription>
            You don&apos;t have permission to access the dashboard
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center text-sm text-muted-foreground">
            <p>Hello {session.user?.name || session.user?.email},</p>
            <p className="mt-2">
              You are logged in but don&apos;t have the required permissions to access this dashboard.
              Please contact your administrator to request access.
            </p>
          </div>
          
          <div className="flex flex-col space-y-2">
            <Button onClick={handleSignOut} variant="destructive" className="w-full">
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 