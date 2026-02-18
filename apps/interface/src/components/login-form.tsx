'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { getAssistantLoginFeatureState } from '@nia/prism/core';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, AudioWaveform, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FcGoogle } from 'react-icons/fc';
import { z } from 'zod';

import { Button } from '@interface/components/ui/button';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from '@interface/components/ui/card';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage
} from '@interface/components/ui/form';
import { Input } from '@interface/components/ui/input';
import { getClientLogger } from '@interface/lib/client-logger';
import { useGlobalSettings } from '@interface/providers/global-settings-provider';

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

// Legal links component - reusable across all login screens
function LegalLinks() {
  return (
    <div 
      style={{
        position: 'absolute',
        bottom: '1.5rem',
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        zIndex: 700, // Z-scale: modal/dialog layer
        width: '100%',
      }}
    >
      <a 
        href="https://rsvp.pearlos.org/privacypolicy" 
        target="_blank" 
        rel="noopener noreferrer"
        style={{
          color: '#9ca3af',
          textDecoration: 'none',
          fontSize: '0.75rem',
          fontWeight: 400,
        }}
      >
        Privacy Policy
      </a>
      <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>•</span>
      <a 
        href="https://rsvp.pearlos.org/tos" 
        target="_blank" 
        rel="noopener noreferrer"
        style={{
          color: '#9ca3af',
          textDecoration: 'none',
          fontSize: '0.75rem',
          fontWeight: 400,
        }}
      >
        Terms of Service
      </a>
    </div>
  );
}

// Login schema for form validation
const LoginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof LoginSchema>;

type AssistantLoginFeatureState = {
  googleAuth: boolean;
  guestLogin: boolean;
  passwordLogin: boolean;
};

const loginLogger = getClientLogger('[login_form]');

export default function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrorScreen, setShowErrorScreen] = useState(false);
  const [isAccessDenied, setIsAccessDenied] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [assistantLoginFeatures, setAssistantLoginFeatures] = useState<AssistantLoginFeatureState>({
    googleAuth: false,
    guestLogin: false,
    passwordLogin: false,
  });

  const [assistantFeaturesReady, setAssistantFeaturesReady] = useState(false);
  const { interfaceLogin } = useGlobalSettings();
  const router = useRouter();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const callbackUrlParam = searchParams?.get('callbackUrl');
  // Default to preserving current path if callbackUrl not present
  const fallbackCallbackUrl = typeof window !== 'undefined' ? window.location.pathname || '/' : '/';
  // Sanitize callbackUrl to same-origin only
  const resolveSameOrigin = (urlLike: string) => {
    try {
      const defaultBase = process.env.NEXT_PUBLIC_INTERFACE_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const base = typeof window !== 'undefined' ? window.location.origin : defaultBase;
      const u = new URL(urlLike, base);
      return u.origin === base ? u.pathname + u.search + u.hash : fallbackCallbackUrl;
    } catch {
      return fallbackCallbackUrl;
    }
  };
  const callbackUrl = resolveSameOrigin(callbackUrlParam || fallbackCallbackUrl);

  // Show Resend Invite button only when visiting via an invite link (token present)
  const inviteToken = searchParams?.get('token') || searchParams?.get('inviteToken');
  const showResendInvite = Boolean(inviteToken);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(LoginSchema),
    mode: 'onChange',
    defaultValues: {
      email: '',
      password: '',
    },
  });

  // Ensure form starts with empty values
  useEffect(() => {
    form.reset({
      email: '',
      password: '',
    });
  }, [form]);

  // Handle mounting to prevent FOUC
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Handle AccessDenied error (permanent ban or deny list)
  useEffect(() => {
    const errorParam = searchParams?.get('error');
    if (errorParam === 'AccessDenied') {
      setIsAccessDenied(true);
    }
  }, [searchParams]);

  // Determine if login methods should be shown based on assistant settings
  useEffect(() => {
    let cancelled = false;
    setAssistantFeaturesReady(false);

    const setPlatformDefaultLogin = () => {
      if (cancelled) {
        return;
      }
      setAssistantLoginFeatures({
        googleAuth: true,
        guestLogin: false,
        passwordLogin: true,
      });
      setAssistantFeaturesReady(true);
    };

    const setLoginErrorState = () => {
      if (cancelled) {
        return;
      }
      setAssistantLoginFeatures({
        googleAuth: false,
        guestLogin: false,
        passwordLogin: false,
      });
      setError('Unable to load login configuration.');
      setAssistantFeaturesReady(true);
    };

    const applyFeatures = (next: AssistantLoginFeatureState) => {
      if (cancelled) {
        return;
      }
      setAssistantLoginFeatures(next);
      setAssistantFeaturesReady(true);
    };

    const decide = async () => {
      try {
        if (searchParams?.get('noguest') === '1') {
          setPlatformDefaultLogin();
          return;
        }

        const cb = callbackUrlParam || fallbackCallbackUrl;
        let assistantSeg = '';
        try {
          const defaultBase = process.env.NEXT_PUBLIC_INTERFACE_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
          const u = new URL(cb, typeof window !== 'undefined' ? window.location.origin : defaultBase);
          assistantSeg = (u.pathname.split('/').filter(Boolean)[0]) || '';
        } catch {
          // Ignore errors
        }

        if (!assistantSeg) {
          setPlatformDefaultLogin();
          return;
        }

        const resp = await fetch(`/api/assistant/meta?agent=${encodeURIComponent(assistantSeg)}`, { cache: 'no-store' });
        if (!resp.ok) {
          setLoginErrorState();
          return;
        }

        const meta: {
          allowAnonymousLogin?: boolean;
          supportedFeatures?: unknown;
        } = await resp.json();
        const loginKeys = new Set(['googleAuth', 'guestLogin', 'passwordLogin']);
        const { supportedList, hasLoginFeatureSelection, guestAllowed } = getAssistantLoginFeatureState(meta);
        const hasSupportedList = supportedList.length > 0;
        const supportsFeature = (key: 'googleAuth' | 'guestLogin' | 'passwordLogin') => {
          if (!hasSupportedList) {
            return true;
          }
          if (!hasLoginFeatureSelection && loginKeys.has(key)) {
            return true;
          }
          return supportedList.includes(key);
        };

        applyFeatures({
          googleAuth: supportsFeature('googleAuth'),
          guestLogin: guestAllowed,
          passwordLogin: supportsFeature('passwordLogin'),
        });
      } catch {
        setLoginErrorState();
      }
    };

    void decide();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callbackUrlParam, fallbackCallbackUrl]);

  // Handle standard email/password login
  const handleSubmit = async (values: LoginFormData) => {
    setLoading(true);
    setError(null);

    try {
      const result = await signIn('credentials', {
        redirect: false,
        email: values.email,
        password: values.password,
        callbackUrl,
      });

      if (result?.error) {
        setShowErrorScreen(true);
        setError(null);
        loginLogger.error('Invalid email or password', { event: 'credentials_rejected' });
      } else {
        router.refresh();
        router.replace(callbackUrl || '/');
      }
    } catch (err) {
      const errorMessage = 'An unexpected error occurred';
      setError(errorMessage);
      loginLogger.error('Login failed', {
        message: errorMessage,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle Google sign-in
  const handleGoogleSignIn = () => {
    signIn('google', { callbackUrl });
  };

  // Handle anonymous/guest login
  const handleGuestSignIn = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await signIn('credentials', {
        redirect: false,
        isAnonymous: true,
        callbackUrl,
      });

      if (result?.error) {
        const errorMessage = 'Failed to create guest session';
        setError(errorMessage);
        loginLogger.error('Guest sign-in failed', { reason: result.error });
      } else {
        router.refresh();
        router.replace(callbackUrl || '/');
      }
    } catch (err) {
      const errorMessage = 'An unexpected error occurred';
      setError(errorMessage);
      loginLogger.error('Guest sign-in unexpected error', {
        message: errorMessage,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle going back to assistant
  const handleBackToAssistant = () => {
    router.replace(callbackUrl || '/');
  };

  const handleResendInvite = async () => {
    try {
      const email = form.getValues('email');
      if (!email) return;
      const res = await fetch('/api/users/resend-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      if (process.env.NODE_ENV !== 'production') {
        loginLogger.info('Invite resend queued');
      }
    } catch (e) {
      loginLogger.error('Resend invite failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleResetPassword = async () => {
    try {
      const res = await fetch('/api/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      if (process.env.NODE_ENV !== 'production') {
        loginLogger.info('Reset password requested');
      }
    } catch (e) {
      loginLogger.error('Reset password request failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  // Show loading screen with proper background to prevent FOUC
  if (!isMounted || !assistantFeaturesReady) {
    return (
      <div className="login-shell">
        {/* Animated Background */}
        <div className="animated-bg"></div>
        
        <main className="login-content-layer" role="main">
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="text-center text-gray-300">
              <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin" />
              <p className="text-sm">Preparing your login experience...</p>
            </div>
          </div>
        </main>

        <LegalLinks />
      </div>
    );
  }

  const showPasswordForm = interfaceLogin.passwordLogin && assistantLoginFeatures.passwordLogin;
  const showGoogleButton = interfaceLogin.googleAuth && assistantLoginFeatures.googleAuth;
  const showGuestButton = interfaceLogin.guestLogin && assistantLoginFeatures.guestLogin;
  const hasAnyLoginOption = showPasswordForm || showGoogleButton || showGuestButton;

  // Show access denied screen - takes priority over all other states
  if (isAccessDenied) {
    return (
      <div className="login-shell">
        {/* Animated Background */}
        <div className="animated-bg"></div>
        
        <main className="login-content-layer" role="main">
          <motion.div
            className="error-container"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="error-header">
              <div className="error-icon">🚫</div>
              <h1 className="error-title">Access Denied</h1>
              <p className="error-description">
                Your access to this platform has been restricted. If you believe this is an error, please contact our support team.
              </p>
            </div>
            
            <div className="error-actions">
              <div className="contact-info">
                <p>Need assistance? Contact our team:</p>
                <a href="mailto:dev@niaxp.com" className="contact-link">
                  dev@niaxp.com
                </a>
              </div>
            </div>
          </motion.div>
        </main>

        <LegalLinks />
      </div>
    );
  }

  // Show error screen for wrong credentials
  if (showErrorScreen) {
    return (
      <div className="login-shell">
        {/* Animated Background */}
        <div className="animated-bg"></div>
        
        <main className="login-content-layer" role="main">
          <motion.div
            className="error-container"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="error-header">
              <div className="error-icon">⚠️</div>
              <h1 className="error-title">Authentication Failed</h1>
              <p className="error-description">
                The credentials you entered are incorrect. Please check your email and password, or contact our support team for assistance.
              </p>
            </div>
            
            <div className="error-actions">
              <button
                className="retry-button"
                onClick={() => setShowErrorScreen(false)}
              >
                Try Again
              </button>
              
              <div className="contact-info">
                <p>Need help? Contact our team:</p>
                <a href="mailto:dev@niaxp.com" className="contact-link">
                  dev@niaxp.com
                </a>
              </div>
            </div>
          </motion.div>
        </main>

        <LegalLinks />
      </div>
    );
  }

  return (
    <div className="login-shell">
      {/* Animated Background */}
      <div className="animated-bg"></div>

      <main className="login-content-layer" role="main">
        <motion.div
          className="login-container"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            className="login-header"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
          >
            <h1 className="login-title">Login</h1>
            {showPasswordForm && (
              <p className="login-description">
                Enter your email below to login to your account
              </p>
            )}
          </motion.div>

          <motion.div
            className="login-form"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
          >
            {showPasswordForm && (
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(handleSubmit)}
                  className="form-content"
                  method="POST"
                  action="#"
                >
                  <div className="form-group">
                    <label htmlFor="email-input" className="form-label">Email</label>
                    <div 
                      style={{
                        width: '100%',
                        background: '#1a1a1a',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '0',
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      <input
                        id="email-input"
                        type="email"
                        className="login-input-field"
                        placeholder="Enter your email address"
                        title="Enter your email address"
                        value={form.watch('email') || ''}
                        onChange={(e) => form.setValue('email', e.target.value)}
                        disabled={loading}
                        autoComplete="email"
                        style={{
                          width: '100%',
                          background: '#1a1a1a',
                          backgroundColor: '#1a1a1a',
                          color: '#ffffff',
                          border: 'none',
                          outline: 'none',
                          fontSize: '0.9rem',
                          fontFamily: 'inherit',
                          padding: '0.75rem 1rem',
                          margin: '0',
                          boxSizing: 'border-box',
                          borderRadius: '12px',
                          appearance: 'none',
                          WebkitAppearance: 'none',
                          MozAppearance: 'none'
                        }}
                      />
                    </div>
                    {form.formState.errors.email && (
                      <p className="error-message">{form.formState.errors.email.message}</p>
                    )}
                  </div>
                  <div className="form-group">
                    <label htmlFor="password-input" className="form-label">Password</label>
                    <div 
                      style={{
                        width: '100%',
                        background: '#1a1a1a',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '0',
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      <input
                        id="password-input"
                        type={showPassword ? 'text' : 'password'}
                        className="login-input-field"
                        placeholder="••••••••"
                        title="Enter your password"
                        value={form.watch('password') || ''}
                        onChange={(e) => form.setValue('password', e.target.value)}
                        disabled={loading}
                        autoComplete="current-password"
                        style={{
                          width: '100%',
                          background: '#1a1a1a',
                          backgroundColor: '#1a1a1a',
                          color: '#ffffff',
                          border: 'none',
                          outline: 'none',
                          fontSize: '0.9rem',
                          fontFamily: 'inherit',
                          padding: '0.75rem 1rem',
                          margin: '0',
                          boxSizing: 'border-box',
                          borderRadius: '12px',
                          appearance: 'none',
                          WebkitAppearance: 'none',
                          MozAppearance: 'none'
                        }}
                      />
                      <ClientOnly>
                        <button
                          type="button"
                          className="password-toggle"
                          onClick={() => setShowPassword(!showPassword)}
                          disabled={loading}
                          style={{
                            position: 'absolute',
                            right: '12px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'none',
                            border: 'none',
                            color: 'rgba(232, 227, 255, 0.6)',
                            cursor: 'pointer',
                            fontSize: '1.1rem',
                            padding: '0.25rem'
                          }}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </ClientOnly>
                    </div>
                    {form.formState.errors.password && (
                      <p className="error-message">{form.formState.errors.password.message}</p>
                    )}
                  </div>

                  {/* Invite utilities: show only when invite token present */}
                  {showResendInvite && (
                    <div className="invite-utilities">
                      <button
                        type="button"
                        className="invite-button"
                        disabled={loading}
                        onClick={handleResendInvite}
                      >
                        Resend Invite
                      </button>
                      <button
                        type="button"
                        className="forgot-password-button"
                        disabled={loading}
                        onClick={handleResetPassword}
                      >
                        Forgot Password?
                      </button>
                    </div>
                  )}

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        className="login-error"
                        initial={{ opacity: 0, y: 12, scale: 0.92 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 12, scale: 0.95 }}
                        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
                        role="alert"
                      >
                        <span className="login-error__icon">!</span>
                        <span>{error}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <button 
                    type="submit" 
                    className="login-button"
                    disabled={loading}
                  >
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {loading ? 'Signing In...' : 'Sign In'}
                  </button>
                </form>
              </Form>
            )}

            {showPasswordForm && showGoogleButton && (
              <div className="login-divider">
                <span>Or continue with</span>
              </div>
            )}

            {showGoogleButton && (
              <button
                type="button"
                className="google-login-button"
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                <FcGoogle className="google-icon" />
                Google
              </button>
            )}

            {showGuestButton && (
              <button
                type="button"
                className="guest-login-button"
                onClick={handleGuestSignIn}
                disabled={loading}
              >
                Continue as Guest
              </button>
            )}

            {!hasAnyLoginOption && (
              <div className="login-warning">
                Login methods are currently disabled. Please contact your administrator for access.
              </div>
            )}

            {/* Show back button if user is already signed in */}
            {session?.user && (
              <button
                type="button"
                className="back-to-assistant-button"
                onClick={handleBackToAssistant}
                disabled={loading}
              >
                Back to Assistant
              </button>
            )}

            {showPasswordForm && (
              <p className="login-footer">
                Don&apos;t have an account?{' '}
                <a href="mailto:dev@niaxp.com" className="login-link">
                  Contact dev@niaxp.com to create one.
                </a>
              </p>
            )}
          </motion.div>
        </motion.div>
      </main>

      <LegalLinks />
    </div>
  );
}
