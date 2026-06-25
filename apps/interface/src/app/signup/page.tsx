'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { getClientLogger } from '@interface/lib/client-logger';

const signupLogger = getClientLogger('[signup]');

const SignupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type SignupFormData = z.infer<typeof SignupSchema>;

function LegalLinks() {
  return (
    <div className="login-legal-links">
      <a
        href="https://rsvp.pearlos.org/privacypolicy"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#9ca3af', textDecoration: 'none', fontSize: '0.75rem', fontWeight: 400 }}
      >
        Privacy Policy
      </a>
      <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>•</span>
      <a
        href="https://rsvp.pearlos.org/tos"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#9ca3af', textDecoration: 'none', fontSize: '0.75rem', fontWeight: 400 }}
      >
        Terms of Service
      </a>
    </div>
  );
}

function ClientOnly({ children }: { children: React.ReactNode }) {
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => { setHasMounted(true); }, []);
  if (!hasMounted) return null;
  return <>{children}</>;
}

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  const searchParams = useSearchParams();
  const callbackUrlParam = searchParams?.get('callbackUrl');
  const fallbackCallbackUrl = typeof window !== 'undefined' ? window.location.pathname || '/' : '/';

  const resolveSameOrigin = (urlLike: string) => {
    try {
      const defaultBase = process.env.NEXT_PUBLIC_INTERFACE_URL || '';
      const base = typeof window !== 'undefined' ? window.location.origin : defaultBase;
      if (!base) return fallbackCallbackUrl;
      const u = new URL(urlLike, base);
      return u.origin === base ? u.pathname + u.search + u.hash : fallbackCallbackUrl;
    } catch {
      return fallbackCallbackUrl;
    }
  };
  const callbackUrl = resolveSameOrigin(callbackUrlParam || fallbackCallbackUrl);

  const form = useForm<SignupFormData>({
    resolver: zodResolver(SignupSchema),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  });

  useEffect(() => { setIsMounted(true); }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 720px)');
    const onChange = () => setIsMobileViewport(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const handleSubmit = async (values: SignupFormData) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const data = await res.json().catch(() => ({ success: false, error: 'Unexpected response' }));

      if (!res.ok || !data.success) {
        setError(data.error || 'Registration failed');
        setLoading(false);
        return;
      }

      // Keep credentials login same-origin by handling navigation client-side.
      const signInResult = await signIn('credentials', {
        redirect: false,
        email: values.email,
        password: values.password,
        callbackUrl,
      });
      if (signInResult?.error) {
        setError('Account created, but auto-login failed. Please sign in manually.');
        router.replace(loginHref);
        return;
      }
      router.replace(callbackUrl || '/');
      router.refresh();
    } catch (err) {
      setError('An unexpected error occurred');
      signupLogger.error('Registration error', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  const loginHref = `/login${callbackUrlParam ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}`;

  if (!isMounted) {
    return (
      <div className="login-shell">
        <div className="animated-bg"></div>
        <main className="login-content-layer login-content-layer-signup" role="main">
          <div className="flex min-h-screen items-center justify-center px-2 py-8 sm:px-4">
            <div className="text-center text-gray-300">
              <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin" />
              <p className="text-sm">Preparing your account screen...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const inputWrapperStyle: React.CSSProperties = {
    width: '100%',
    background: '#1a1a1a',
    border: 'none',
    borderRadius: '12px',
    padding: '0',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  };

  const inputStyle: React.CSSProperties = {
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
    MozAppearance: 'none' as React.CSSProperties['MozAppearance'],
  };

  const { errors } = form.formState;
  const hasSignupErrors = Boolean(error) || Object.keys(errors).length > 0;

  return (
    <div className="login-shell">
      <div className="animated-bg"></div>

      <main className="login-content-layer login-content-layer-signup" role="main">
        <motion.div
          className={`login-container signup-container${hasSignupErrors ? ' signup-container--with-errors' : ''}`}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: isMobileViewport ? 1 : 0.9 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            className="login-header"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
          >
            <h1 className="login-title">Create Account</h1>
            <p className="login-description">
              Enter your details below to create your account
            </p>
          </motion.div>

          <motion.div
            className="login-form"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
          >
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="form-content"
              method="POST"
              action="#"
            >
              <div className="form-group">
                <label htmlFor="name-input" className="form-label">Full Name</label>
                <div style={inputWrapperStyle}>
                  <input
                    id="name-input"
                    type="text"
                    className="login-input-field"
                    placeholder="Enter your full name"
                    title="Enter your full name"
                    value={form.watch('name') || ''}
                    onChange={(e) => form.setValue('name', e.target.value, { shouldValidate: true })}
                    disabled={loading}
                    autoComplete="name"
                    style={inputStyle}
                  />
                </div>
                {form.formState.errors.name && (
                  <p className="error-message">{form.formState.errors.name.message}</p>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="email-input" className="form-label">Email</label>
                <div style={inputWrapperStyle}>
                  <input
                    id="email-input"
                    type="email"
                    className="login-input-field"
                    placeholder="Enter your email address"
                    title="Enter your email address"
                    value={form.watch('email') || ''}
                    onChange={(e) => form.setValue('email', e.target.value, { shouldValidate: true })}
                    disabled={loading}
                    autoComplete="email"
                    style={inputStyle}
                  />
                </div>
                {form.formState.errors.email && (
                  <p className="error-message">{form.formState.errors.email.message}</p>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="password-input" className="form-label">Password</label>
                <div style={inputWrapperStyle}>
                  <input
                    id="password-input"
                    type={showPassword ? 'text' : 'password'}
                    className="login-input-field"
                    placeholder="At least 8 characters"
                    title="Enter your password"
                    value={form.watch('password') || ''}
                    onChange={(e) => form.setValue('password', e.target.value, { shouldValidate: true })}
                    disabled={loading}
                    autoComplete="new-password"
                    style={inputStyle}
                  />
                  <ClientOnly>
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={loading}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </ClientOnly>
                </div>
                {form.formState.errors.password && (
                  <p className="error-message">{form.formState.errors.password.message}</p>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="confirm-password-input" className="form-label">Confirm Password</label>
                <div style={inputWrapperStyle}>
                  <input
                    id="confirm-password-input"
                    type={showConfirmPassword ? 'text' : 'password'}
                    className="login-input-field"
                    placeholder="Re-enter your password"
                    title="Confirm your password"
                    value={form.watch('confirmPassword') || ''}
                    onChange={(e) => form.setValue('confirmPassword', e.target.value, { shouldValidate: true })}
                    disabled={loading}
                    autoComplete="new-password"
                    style={inputStyle}
                  />
                  <ClientOnly>
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      disabled={loading}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </ClientOnly>
                </div>
                {form.formState.errors.confirmPassword && (
                  <p className="error-message">{form.formState.errors.confirmPassword.message}</p>
                )}
              </div>

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
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>

            <div className="login-form-footer-stack">
              <p className="login-footer">
                Already have an account?{' '}
                <a href={loginHref} className="login-link">
                  Sign in
                </a>
              </p>
              <LegalLinks />
            </div>
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}
