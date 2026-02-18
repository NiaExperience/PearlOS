/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
import { NextAuthOptions, DefaultSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { v4 as uuidv4 } from 'uuid';

import { IUser } from "../blocks/user.block";
import { getLogger } from "../logger";

// Lazy loaders to defer heavy/ESM dependent modules until actually needed (improves test isolation)
const AnonymousUserActions = () => require("../actions/anonymous-user-actions") as typeof import("../actions/anonymous-user-actions");
const UserActions = () => require("../actions/user-actions") as typeof import("../actions/user-actions");
const AccountActions = () => require("../actions/account-actions") as typeof import("../actions/account-actions");
const Utils = () => require("../utils") as typeof import("../utils");

const log = getLogger('prism:auth');

// This file extends the NextAuth session and user types to include custom properties
// We declare it once, here.

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      sessionId: string;
      is_anonymous?: boolean;
      google_access_token?: string; // Optional, only if using Google OAuth
      mustSetPassword?: boolean; // Require initial password setup for credential users without password
      emailVerified?: string | Date | null; // Track verification timestamp
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    sessionId: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    is_anonymous?: boolean; // Custom property for anonymous users
    google_access_token?: string; // Optional, only if using Google OAuth
    mustSetPassword?: boolean; // Flag for initial password setup
    emailVerified?: string | Date | null; // Verification timestamp
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    sessionId?: string;
    is_anonymous?: boolean; // Custom property for anonymous users
    google_access_token?: string; // Optional, only if using Google OAuth
    mustSetPassword?: boolean;
    emailVerified?: string | Date | null;
  }
}

// Configuration interface for app-specific auth settings
export interface AppAuthConfig {
  appType: 'interface' | 'dashboard';
  baseUrl: string;
  googleCredentials: {
    clientId: string;
    clientSecret: string;
  };
  cookiePrefix?: string;
  pages?: {
    signIn?: string;
    error?: string;
  };
  redirectHandler?: (url: string, baseUrl: string) => string;
}

function resolveSessionId(token: any, session: any): string {
  if (token?.sessionId) return token.sessionId;
  if (session?.user?.sessionId) return session.user.sessionId;
  if (token?.userId) return token.userId;
  return uuidv4();
}

function mergeSessionUser(baseSession: any, userData: any, currentUser: any) {
  if (!userData) {
    return {
      ...currentUser,
      ...baseSession,
    };
  }

  return {
    ...currentUser,
    ...baseSession,
    name: userData.name,
    email: userData.email,
    image: userData.image || null,
    emailVerified: userData.emailVerified || baseSession.emailVerified,
  };
}

function applyUserToToken(token: any, user: any, account: any) {
  token.userId = user.id;
  token.is_anonymous = user.is_anonymous || false;
  token.sessionId = token.sessionId || user.sessionId || uuidv4();
  token.google_access_token = user.google_access_token;
  if (user.emailVerified) {
    token.emailVerified = user.emailVerified;
  }
  const mustSetPassword = user.mustSetPassword || false;
  token.mustSetPassword = account?.provider === 'google' || user.google_access_token ? false : mustSetPassword;
}

async function fetchUserData(userId: string) {
  try {
    return await UserActions().getUserById(userId);
  } catch (error) {
    log.error('Error fetching user data for session', { error, userId });
    return null;
  }
}

async function populateSessionFromToken(session: any, token: any) {
  if (!token || !token.userId || !session?.user) return;

  const sessionId = resolveSessionId(token, session);
  token.sessionId = token.sessionId || sessionId;

  const baseSession = {
    id: token.userId,
    sessionId,
    is_anonymous: token.is_anonymous || false,
    google_access_token: token.google_access_token,
    mustSetPassword: token.mustSetPassword || false,
    emailVerified: token.emailVerified || null,
  };

  const userData = await fetchUserData(token.userId);
  session.user = mergeSessionUser(baseSession, userData, session.user);
}

async function processSignIn(user: any, account: any, profile: any) {
  try {
    // Check email deny list before any other processing
    if (user.email) {
      const GlobalSettingsActions = () => require("../actions/globalSettings-actions") as typeof import("../actions/globalSettings-actions");
      try {
        const globalSettings = await GlobalSettingsActions().getGlobalSettings();
        const denyList = globalSettings?.denyListEmails || [];
        const normalizedEmail = user.email.toLowerCase();
        if (denyList.some((email: string) => email.toLowerCase() === normalizedEmail)) {
          log.warn('Sign-in denied: email is in deny list', { email: user.email });
          throw new Error('ACCESS_DENIED');
        }
      } catch (denyListError) {
        // Re-throw ACCESS_DENIED errors
        if (denyListError instanceof Error && denyListError.message === 'ACCESS_DENIED') {
          throw denyListError;
        }
        // Log but don't block sign-in if we can't check the deny list
        log.warn('Failed to check email deny list', { error: denyListError });
      }
    }

    let existingUser = null;

    if (account && account.provider === "google") {
      log.info('Using OAuth provider');
      existingUser = await UserActions().getUserByEmail(user.email!);
      if (existingUser) {
        // Persist user ID to session
        user.id = existingUser._id!;
        // Prepare to update the user with incoming data
        const updates: Partial<IUser> = {} as any;
        // Get Google profile information
        const googleName = (profile as any)?.name || user.name;
        const googleImage = (profile as any)?.picture || user.image;
        if (googleName && googleName !== existingUser.name) {
          updates.name = googleName;
        }
        if (googleImage && googleImage !== existingUser.image) {
          updates.image = googleImage as any;
        }
        // Store access token for Google OAuth in session
        user.google_access_token = account.access_token;

        // If user has not yet been marked verified,
        // set emailVerified now (Google auth guarantees verified email)
        if (!existingUser.emailVerified) {
          const verifiedAt = new Date();
          updates.emailVerified = verifiedAt;
          // Reflect persisted updates in memory copy
          user.emailVerified = verifiedAt as any;
        } else {
          user.emailVerified = existingUser.emailVerified as any;
        }

        // Persist name/image if changed even when already verified
        if (Object.keys(updates).length > 0) {
          try {
            await UserActions().updateUser(existingUser._id!, { ...existingUser, ...(updates as any) } as IUser);
          } catch (e) {
            log.warn('Failed to persist Google profile fields', { userId: existingUser._id, error: e });
          }
        }

        // update user's account record if it exists
        if (account) {
          // Find the account...
          const existingAccount = await AccountActions().getUserAccountByProvider(
            existingUser._id!,
            account.provider
          );
          if (existingAccount) {
            log.info('Updating existing user account for OAuth provider', { userId: existingUser._id, provider: account.provider });
            // Update existing account record linking to OAuth provider
            // Only store essential tokens per Google's security recommendations
            const updateData = {
              ...existingAccount,
              refresh_token: account.refresh_token, // Essential for token refresh
              expires_at: account.expires_at,       // Essential for token management
              scope: account.scope,                 // Essential for permission tracking
            };
            await AccountActions().updateAccount(existingAccount._id, updateData);
          } else {
            log.info('Creating user account for OAuth provider', { userId: existingUser._id, provider: account.provider });
            // Create account record linking to OAuth provider
            // Only store essential tokens per Google's security recommendations
            await AccountActions().createAccount({
              userId: existingUser._id!,
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              type: account.type,
              refresh_token: account.refresh_token, // Essential for token refresh
              expires_at: account.expires_at,       // Essential for token management
              scope: account.scope,                 // Essential for permission tracking
            });
          }
        }

      } else if (account && user.email) {
        // Create new user in our database
        const newUser = await UserActions().createUser({
          email: user.email!,
          name: user.name!,
          image: user.image ? user.image : undefined,
          // Mark as verified immediately since Google provider asserts verified email
          emailVerified: new Date(),
        });

        if (!newUser._id) {
          throw new Error('Failed to create user');
        }

        log.info('Created new user record', { userId: newUser._id, email: newUser.email });

        if (account) {
          log.info('Creating user account for OAuth provider', { userId: newUser._id, provider: account.provider });
          // Create account record linking to OAuth provider
          // Only store essential tokens per Google's security recommendations
          await AccountActions().createAccount({
            userId: newUser._id,
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            type: account.type,
            refresh_token: account.refresh_token, // Essential for token refresh
            expires_at: account.expires_at,       // Essential for token management
            scope: account.scope,                 // Essential for permission tracking
          });
        }

        // Update user id to reference our database
        user.id = (newUser as any).page_id || newUser._id;
        user.emailVerified = newUser.emailVerified as any;
      }

      // Google auth is considered fully provisioned; ensure mustSetPassword is never set
      user.mustSetPassword = false;

    } else if (!user.email) {
      log.info('Creating anonymous user');
      const anon = await AnonymousUserActions().createAnonymousUser();
      if (!anon || !anon._id) {
        log.error('Failed to create anonymous user');
        return false; // Prevent sign-in
      }
      user.id = anon._id;
      user.is_anonymous = true; // Mark as anonymous user
    }
  } catch (error) {
    // Check for ACCESS_DENIED error and redirect to error page with specific message
    if (error instanceof Error && error.message === 'ACCESS_DENIED') {
      log.warn('Access denied for user - email in deny list');
      return '/login?error=AccessDenied';
    }
    log.error('Error in signIn callback', { error });
    return false; // Prevent sign-in on error
  }
  return true;
}

// Factory function to create auth options with app-specific configuration
export function createAuthOptions(config: AppAuthConfig): NextAuthOptions {
  const {
    appType,
    baseUrl,
    googleCredentials,
    cookiePrefix = appType, // Default to appType if not provided
    pages = { signIn: '/login' },
    redirectHandler
  } = config;

  return {
    // The base path is determined by the file location in the App Router

    // Use custom pages for auth flows
    pages,

    providers: [
      // Standard credentials provider
      CredentialsProvider({
        id: 'credentials',
        name: "Credentials",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials) {
          log.info('Starting authorize function');
          try {
            // Check if this is an explicit anonymous login request
            if (!credentials || !credentials?.email) {
              // Sign in anonymously - we'll create the actual anonymous user in the signIn callback
              log.info('Anonymous login requested');
              const authResponse = {
                id: 'anonymous', // Temporary ID - will be replaced with actual anonymous user ID in signIn callback
                email: null,
                name: 'Guest',
                image: null,
                is_anonymous: true,
                sessionId: uuidv4(), // New session ID for the current session
              }
              return authResponse;
            }

            log.info('Looking for user by email', { email: credentials.email });
            const existingUser = await UserActions().getUserByEmail(credentials.email);
            if (!existingUser || !existingUser._id) {
              log.error('User not found or ID is not defined', { email: credentials.email });
              return null;
            }

            // If user has no password yet (invited user), flag for initial password setup
            if (!existingUser.password_hash) {
              log.warn('User has no password set; allowing provisional sign-in to set initial password', { userId: existingUser._id });
              return {
                id: (existingUser as any)._id,
                email: existingUser.email,
                name: existingUser.name,
                image: existingUser.image,
                is_anonymous: false,
                sessionId: uuidv4(), // New session ID for the current session
                mustSetPassword: true,
              };
            }

            log.info('User found, verifying password', { userId: existingUser._id });
            const isPasswordValid = await UserActions().verifyUserPassword((existingUser as any)._id, credentials.password);
            if (!isPasswordValid) {
              log.error('Invalid password', { userId: existingUser._id });
              return null;
            }
            log.info('Password valid', { userId: existingUser._id });

            // Prepare to update the user (emailVerified)
            const updates: Partial<IUser> = {} as any;

            // If user has not yet been marked verified,
            // set emailVerified now
            if (!existingUser.emailVerified) {
              const verifiedAt = new Date();
              updates.emailVerified = verifiedAt;
              // Reflect persisted updates in memory copy
              existingUser.emailVerified = verifiedAt as any;
            } else {
              existingUser.emailVerified = existingUser.emailVerified as any;
            }

            // Persist name/image if changed even when already verified
            if (Object.keys(updates).length > 0) {
              try {
                await UserActions().updateUser(existingUser._id!, { ...existingUser, ...(updates as any) } as IUser);
              } catch (e) {
                log.warn('Failed to update user', { userId: existingUser._id, error: e });
              }
            }

            // TODO: Determine if we started with an anonymous user, and figure out how 
            // to copy over the message store info from the AnonymousUser to the new User

            const authResponse = {
              id: (existingUser as any).page_id || (existingUser as any)._id,
              email: existingUser.email,
              name: existingUser.name,
              image: existingUser.image,
              is_anonymous: false, // This is a regular user, not anonymous
              sessionId: uuidv4(), // New session ID for the current session
              mustSetPassword: false,
            };
            log.info('Authorization successful', { userId: authResponse.id, isAnonymous: authResponse.is_anonymous });
            return authResponse;
          } catch (error) {
            log.error('Error in authorize function', { error });
            return null;
          }
        }
      }),
      GoogleProvider({
        ...googleCredentials,
        // Let NextAuth compute correct redirect_uri; overriding can cause mismatches.
        // Keep minimal customization; add runtime log for diagnostics.
        authorization: {
          params: {
            // Additional scopes can be appended here if needed.
            // Intentionally not setting redirect_uri to avoid provider mismatch.
          }
        }
      }),
    ],
    callbacks: {
      async signIn({ user, account, profile, email, credentials }) {
        log.info('Sign in attempt', { user: user.email, provider: account?.provider });
        return processSignIn(user, account, profile);
      },
      async jwt({ token, user, account, profile }) {
        if (user) {
          applyUserToToken(token, user, account);
        }
        return token;
      },
      async session({ session, token }) {
        await populateSessionFromToken(session, token);
        return session;
      },
      async redirect({ url, baseUrl }) {
        // Use custom redirect handler if provided
        if (redirectHandler) {
          return redirectHandler(url, baseUrl);
        }

        // Default redirect logic
        // Security: Ensure no credentials are passed in redirect URLs
        if (url.startsWith(baseUrl)) {
          // Check for NextAuth API endpoint or login page - redirect to base URL which will then go to our custom /login page
          if (url.includes('/auth/signin') || url.includes('/login')) {
            log.info('Redirecting to base URL after sign-in');
            return baseUrl;
          }
          // Use security utility to sanitize URL
          return Utils().sanitizeUrl(url);
        }
        return baseUrl;
      },
    },
    // Use the default NextAuth session strategy
    session: {
      strategy: "jwt",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    },
    secret: process.env.NEXTAUTH_SECRET,
    useSecureCookies: process.env.NODE_ENV === "production",
    cookies: {
      sessionToken: {
        name: process.env.NODE_ENV === "production"
          ? `__Secure-${cookiePrefix}.session-token`
          : `${cookiePrefix}.session-token`,
        options: {
          httpOnly: true,
          sameSite: 'lax', // Try 'none' if you're having cross-domain issues
          path: '/',
          secure: process.env.NODE_ENV === 'production',
          maxAge: 30 * 24 * 60 * 60, // 30 days
        },
      },
      callbackUrl: {
        name: `${cookiePrefix}.callback-url`,
        options: {
          sameSite: 'lax',
          path: '/',
          secure: process.env.NODE_ENV === 'production',
        },
      },
      csrfToken: {
        name: `${cookiePrefix}.csrf-token`,
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: process.env.NODE_ENV === 'production',
        },
      },
    },
    debug: false, // Set to true for debugging in development
    logger: {
      error(code, ...message) {
        log.error('[AUTH ERROR]', { code, message });
      },
      warn(code, ...message) {
        log.warn('[AUTH WARN]', { code, message });
      },
      debug(code, ...message) {
        //console.debug('🔍 [AUTH DEBUG]', code, ...message);
      },
    },
  };
}
