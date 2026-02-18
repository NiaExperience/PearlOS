'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AudioWaveform, Loader2, Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { FcGoogle } from 'react-icons/fc';
import { z } from 'zod';

import { Button } from '@dashboard/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dashboard/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@dashboard/components/ui/form';
import { Input } from '@dashboard/components/ui/input';
import { useToast } from '@dashboard/hooks/use-toast';

// Client-side only wrapper to prevent hydration mismatches
function ClientOnly({ children }: { children: React.ReactNode }) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return null;
  }

  return <>{children}</>;
}

// Login schema for form validation
const LoginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof LoginSchema>;

export function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const form = useForm<LoginFormData>({
    resolver: zodResolver(LoginSchema),
    mode: 'onChange',
  });

  // Handle standard email/password login
  const handleSubmit = async (values: LoginFormData) => {
    setLoading(true);
    setError(null);

    try {
      const result = await signIn('credentials', {
        redirect: false,
        email: values.email,
        password: values.password,
        callbackUrl: '/dashboard',
      });

      if (result?.error) {
        const errorMessage = 'Invalid email or password';
        setError(errorMessage);
        toast({
          title: 'Login failed',
          description: errorMessage,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Login successful',
          description: 'You have successfully logged in',
        });
        router.refresh();
        router.push('/dashboard');
      }
    } catch (err) {
      const errorMessage = 'An unexpected error occurred';
      setError(errorMessage);
      toast({
        title: 'Login failed',
        description: errorMessage,
        variant: 'destructive',
      });
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Handle Google sign-in
  const handleGoogleSignIn = () => {
    signIn('google', { callbackUrl: '/dashboard' });
  };

  // Resend invite (for provisional account without password)
  const handleResendInvite = async () => {
    try {
      const email = form.getValues('email');
      if (!email) return;
      const res = await fetch('/api/users/resend-invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      toast({ title: 'Invite sent', description: 'Check your email for the invite link.' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message || 'Failed to resend invite', variant: 'destructive' });
    }
  };

  // Request password reset (placeholder)
  const handleResetPassword = async () => {
    try {
      const email = form.getValues('email');
      if (!email) return;
      // We don't know userId from email here simply; backend route expects session or userId; for now just fire to show UX (will 401 if not logged in).
      const res = await fetch('/api/users/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      toast({ title: 'Reset requested', description: 'Check your email for reset instructions.' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message || 'Failed to request reset', variant: 'destructive' });
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center">
      <Card className='mx-auto max-w-sm w-full relative z-40 border-border bg-card dark:bg-black backdrop-blur-sm shadow-2xl'>
        <CardHeader className="pb-4">
          {/* <AudioWaveform className='border p-2 size-10 bg-primary text-primary-foreground rounded-lg mb-3' /> */}
          <CardTitle className='text-2xl text-card-foreground font-bold text-center'>Login Now</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">Enter your email below to login to your account</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className='space-y-4'
              method='POST'
              action='#'
            >
              <FormField
                control={form.control}
                name='email'
                render={({ field }: { field: any }) => (
                  <FormItem>
                    <FormLabel className="text-sm text-foreground">Email</FormLabel>
                    <FormControl>
                      <Input
                        className="bg-input/50 border-input text-foreground placeholder:text-muted-foreground focus:border-ring h-10 text-sm"
                        placeholder='john@example.com'
                        {...field}
                        value={field.value ?? ''}
                        disabled={loading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='password'
                render={({ field }: { field: any }) => (
                  <FormItem>
                    <FormLabel className="text-sm text-foreground">Password</FormLabel>
                    <FormControl>
                      <div className='relative'>
                        <Input
                          className="bg-input/50 border-input text-foreground placeholder:text-muted-foreground focus:border-ring h-10 text-sm"
                          placeholder='****'
                          type={showPassword ? 'text' : 'password'}
                          {...field}
                          value={field.value ?? ''}
                          disabled={loading}
                        />
                        <ClientOnly>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent text-muted-foreground hover:text-foreground'
                            onClick={() => setShowPassword(!showPassword)}
                            disabled={loading}
                          >
                            {showPassword ? (
                              <EyeOff className='h-4 w-4' />
                            ) : (
                              <Eye className='h-4 w-4' />
                            )}
                          </Button>
                        </ClientOnly>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && (
                <p className='text-sm font-medium text-destructive'>{error}</p>
              )}

              <Button type='submit' className='w-full text-primary-foreground h-10 text-sm font-medium rounded-md bg-gradient-to-r from-[#00bcd4] to-[#004d60] hover:from-[#008299] hover:to-[#00313A]' disabled={loading}>
                {loading && <Loader2 className='size-4 animate-spin mr-1' />}
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
              <div className='flex flex-col gap-2 pt-1'>
                <Button type='button' variant='outline' disabled={loading} onClick={handleResendInvite} className='w-full h-8 text-xs'>Resend Invite</Button>
                <Button type='button' variant='ghost' disabled={loading} onClick={handleResetPassword} className='w-full h-8 text-xs'>Forgot Password?</Button>
              </div>
            </form>
          </Form>

          <div className='relative my-4'>
            <div className='absolute inset-0 flex items-center'>
              <div className='w-full border-t border-border'></div>
            </div>
            <div className='relative flex justify-center text-xs'>
              <span className='px-2 bg-card text-muted-foreground'>
                Or continue with
              </span>
            </div>
          </div>

          <Button
            type='button'
            variant='outline'
            className='w-full border-border bg-transparent text-foreground hover:bg-accent h-10 text-sm'
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <FcGoogle className='mr-2 h-4 w-4' />
            Google
          </Button>

          <div className='mt-4 text-center text-xs text-muted-foreground'>
            Don&apos;t have an account? <br /> Contact{' '}
            <span className='underline cursor-pointer text-primary hover:text-primary/80'>dev@niaxp.com</span>{' '}
            to create one.
          </div>
        </CardContent>
      </Card>

      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Nia. All Rights Reserved.
      </div>
    </div>
  );
}
