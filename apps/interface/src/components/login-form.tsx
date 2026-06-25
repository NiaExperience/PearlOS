'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, AudioWaveform, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import React, { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { isFeatureEnabled } from '@nia/features';

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
import { BetaWaitlistSignboard } from '@interface/components/BetaWaitlistSignboard';

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
    <div className="login-legal-links">
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
  passwordLogin: boolean;
};

const loginLogger = getClientLogger('[login_form]');

const NON_ASSISTANT_ROUTES = ['login', 'signup', 'accept-invite', 'reset-password', 'recovery', 'share', 'health', 'api', 'auth'];
const LOGIN_FEATURE_KEYS = ['googleAuth', 'guestLogin', 'passwordLogin'] as const;

// Google sign-in is always available on the interface login screen, regardless
// of per-assistant `supportedFeatures.googleAuth` or the global
// `interfaceLogin.googleAuth` toggle. Who can actually *complete* Google
// sign-in is still governed by `GlobalSettings.allowListEmails` and
// `denyListEmails` in Postgres (see docs/google-signin-allowlist.md).
// Set this to `false` to restore the old flag-gated behavior.
const GOOGLE_LOGIN_ALWAYS_ON = true;
const GOOGLE_ONLY_LOGIN = true;

function GoogleLogo() {
  return (
    <svg className="google-login-logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

export default function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAccessDenied, setIsAccessDenied] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [isSubmittingWaitlist, setIsSubmittingWaitlist] = useState(false);
  const [waitlistMessage, setWaitlistMessage] = useState<string | null>(null);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  /** Join button: green "Sent" or red "Failed" for 5s after response, then idle */
  const [waitlistJoinButtonFeedback, setWaitlistJoinButtonFeedback] = useState<
    'idle' | 'success' | 'failed'
  >('idle');
  const waitlistJoinFeedbackResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [assistantLoginFeatures, setAssistantLoginFeatures] = useState<AssistantLoginFeatureState>({
    googleAuth: false,
    passwordLogin: false,
  });

  const [assistantFeaturesReady, setAssistantFeaturesReady] = useState(false);
  const { interfaceLogin } = useGlobalSettings();
  const router = useRouter();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const callbackUrlParam = searchParams?.get('callbackUrl');
  // Default to root if current path is a non-assistant route (e.g. /login, /signup)
  const rawPath = typeof window !== 'undefined' ? window.location.pathname || '/' : '/';
  const firstSeg = rawPath.split('/').filter(Boolean)[0] || '';
  const fallbackCallbackUrl = NON_ASSISTANT_ROUTES.includes(firstSeg) ? '/' : rawPath;
  // Sanitize callbackUrl to same-origin only
  const resolveSameOrigin = (urlLike: string) => {
    try {
      const defaultBase = process.env.NEXT_PUBLIC_INTERFACE_URL || '';
      const base = typeof window !== 'undefined' ? window.location.origin : defaultBase;
      if (!base) return fallbackCallbackUrl;
      const u = new URL(urlLike, base);
      const targetFirstSeg = u.pathname.split('/').filter(Boolean)[0] || '';
      if (u.origin !== base || NON_ASSISTANT_ROUTES.includes(targetFirstSeg)) {
        return fallbackCallbackUrl;
      }
      return u.pathname + u.search + u.hash;
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
    mode: 'onBlur',
    reValidateMode: 'onBlur',
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

  useEffect(() => {
    return () => {
      if (waitlistJoinFeedbackResetRef.current) {
        clearTimeout(waitlistJoinFeedbackResetRef.current);
      }
    };
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
        const callbackSource = callbackUrl || fallbackCallbackUrl;
        const assistant = new URL(callbackSource, window.location.origin)
          .pathname
          .split('/')
          .filter(Boolean)[0] || '';

        if (!assistant || NON_ASSISTANT_ROUTES.includes(assistant)) {
          setPlatformDefaultLogin();
          return;
        }

        const response = await fetch(`/api/assistant/meta?agent=${encodeURIComponent(assistant)}`, {
          cache: 'no-store',
        });

        if (!response.ok) {
          setPlatformDefaultLogin();
          return;
        }

        const meta = await response.json() as { supportedFeatures?: string[] };
        const supportedFeatures = Array.isArray(meta.supportedFeatures) ? meta.supportedFeatures : undefined;
        const hasLoginFeatureSelection = Boolean(
          supportedFeatures?.some(feature => LOGIN_FEATURE_KEYS.includes(feature as typeof LOGIN_FEATURE_KEYS[number])),
        );

        if (!hasLoginFeatureSelection) {
          setPlatformDefaultLogin();
          return;
        }

        applyFeatures({
          googleAuth: isFeatureEnabled('googleAuth', supportedFeatures),
          passwordLogin: isFeatureEnabled('passwordLogin', supportedFeatures),
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
      // Keep credentials login same-origin by handling navigation client-side.
      const result = await signIn('credentials', {
        redirect: false,
        email: values.email,
        password: values.password,
        callbackUrl,
      });
      if (result?.error) {
        setError('Invalid email or password');
        return;
      }
      router.replace(callbackUrl || '/');
      router.refresh();
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

  // Handle going back to assistant
  const handleBackToAssistant = () => {
    router.replace(callbackUrl || '/');
  };

  const handleJoinEarlyAccess = () => {
    const params = new URLSearchParams();
    params.set('error', 'AccessDenied');
    if (callbackUrlParam) {
      params.set('callbackUrl', callbackUrl);
    }
    router.push(`/login?${params.toString()}`);
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

  const clearWaitlistJoinFeedbackTimer = () => {
    if (waitlistJoinFeedbackResetRef.current) {
      clearTimeout(waitlistJoinFeedbackResetRef.current);
      waitlistJoinFeedbackResetRef.current = null;
    }
  };

  const scheduleWaitlistJoinFeedbackReset = () => {
    clearWaitlistJoinFeedbackTimer();
    waitlistJoinFeedbackResetRef.current = setTimeout(() => {
      waitlistJoinFeedbackResetRef.current = null;
      setWaitlistJoinButtonFeedback('idle');
    }, 5000);
  };

  const handleWaitlistSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearWaitlistJoinFeedbackTimer();
    setWaitlistJoinButtonFeedback('idle');
    setWaitlistMessage(null);
    setWaitlistError(null);

    const normalized = waitlistEmail.trim().toLowerCase();
    if (!normalized) {
      setWaitlistError('Please enter your email address.');
      return;
    }

    setIsSubmittingWaitlist(true);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWaitlistError(
          typeof data.error === 'string'
            ? data.error
            : 'Could not join the waitlist right now. Please try again.'
        );
        setWaitlistJoinButtonFeedback('failed');
        scheduleWaitlistJoinFeedbackReset();
        return;
      }

      const successMessage =
        typeof data.message === 'string'
          ? data.message
          : 'You are on the waitlist. We send invites in weekly batches.';
      setWaitlistMessage(successMessage);
      setWaitlistEmail('');
      setWaitlistJoinButtonFeedback('success');
      scheduleWaitlistJoinFeedbackReset();
    } catch {
      setWaitlistError('Could not join the waitlist right now. Please try again.');
      setWaitlistJoinButtonFeedback('failed');
      scheduleWaitlistJoinFeedbackReset();
    } finally {
      setIsSubmittingWaitlist(false);
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

      </div>
    );
  }

  const showPasswordForm = GOOGLE_ONLY_LOGIN
    ? false
    : interfaceLogin.passwordLogin && assistantLoginFeatures.passwordLogin;
  // Bypass both feature-flag gates when the kill-switch above is on.
  const showGoogleLogin = GOOGLE_LOGIN_ALWAYS_ON
    ? true
    : interfaceLogin.googleAuth && assistantLoginFeatures.googleAuth;
  const hasAnyLoginOption = showPasswordForm || showGoogleLogin;

  // Show access denied screen - takes priority over all other states
  if (isAccessDenied) {
    return (
      <div className="login-shell beta-denied-page">
        <div className="animated-bg" />

        <main className="login-content-layer" role="main">
          <motion.div
            className="beta-denied-shell"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <BetaWaitlistSignboard
              email={waitlistEmail}
              onEmailChange={(value) => {
                setWaitlistEmail(value);
                setWaitlistJoinButtonFeedback((f) => (f === 'failed' ? 'idle' : f));
              }}
              onSubmit={(event) => void handleWaitlistSignup(event)}
              isSubmitting={isSubmittingWaitlist}
              joinButtonFeedback={waitlistJoinButtonFeedback}
              error={waitlistError}
              message={waitlistMessage}
            />
            <style jsx>{`
              /* Layout + waitlist field/button styles live in globals.css (beat login-shell input width:100%) */
              .beta-denied-shell {
                width: min(100%, 506px) !important;
                max-width: 506px !important;
                margin: 0 auto;
                padding: 0 max(0.75rem, env(safe-area-inset-right)) 0
                  max(0.75rem, env(safe-area-inset-left));
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                display: flex;
                flex-direction: column;
                align-items: stretch;
                gap: 0.5rem;
                font-family: 'Poppins', 'Segoe UI', system-ui, -apple-system, sans-serif;
              }

              .beta-waitlist-error {
                margin: 0.15rem 0 0;
                font-size: 0.72rem;
                line-height: 1.45;
                color: #ffb4b4;
                text-align: center;
              }
            `}</style>
          </motion.div>
        </main>
      </div>
    );
  }

  // For bad credentials, NextAuth redirects back to /login with an error query param.
  // We avoid a separate error screen to keep the flow simple and consistent.

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
            {!GOOGLE_ONLY_LOGIN && showPasswordForm && (
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
            {showGoogleLogin && (
              <div className="login-oauth-stack">
                <button
                  type="button"
                  className="google-login-button"
                  disabled={loading}
                  onClick={() => void signIn('google', { callbackUrl })}
                >
                  <GoogleLogo />
                  Continue with Google
                </button>
                <button
                  type="button"
                  className="early-access-login-button"
                  disabled={loading}
                  onClick={handleJoinEarlyAccess}
                >
                  Join wait list
                </button>
              </div>
            )}

            {showGoogleLogin && showPasswordForm && (
              <div className="login-divider">
                <span>or</span>
              </div>
            )}

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
                          fontSize: '16px',
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
                          fontSize: '16px',
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

            <div className="login-form-footer-stack">
              {showPasswordForm && (
                <p className="login-footer">
                  Don&apos;t have an account?{' '}
                  <a href={`/signup${callbackUrlParam ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}`} className="login-link">
                    Create an account
                  </a>
                </p>
              )}
              <LegalLinks />
            </div>
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}
