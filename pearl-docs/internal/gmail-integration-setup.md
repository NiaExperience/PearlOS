# Gmail Integration - Environment Setup

## ✅ Status: FULLY FUNCTIONAL

The Gmail integration is complete and working. This document covers the environment setup required for the OAuth flow.

## Required Environment Variables

### Google OAuth Credentials

The Gmail integration uses interface-specific OAuth credentials for token refresh:

```bash
# PRIMARY: Interface-specific credentials (REQUIRED)
GOOGLE_INTERFACE_CLIENT_ID=your_interface_specific_client_id
GOOGLE_INTERFACE_CLIENT_SECRET=your_interface_specific_client_secret

# FALLBACK: Primary Google OAuth credentials (optional)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

**Important**: The token refresh system specifically uses `GOOGLE_INTERFACE_CLIENT_ID` and `GOOGLE_INTERFACE_CLIENT_SECRET`. Make sure these are set correctly.

### NextAuth Configuration

```bash
# Base URLs for OAuth redirects
NEXTAUTH_INTERFACE_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret_key
```

## Google Cloud Console Setup

### 1. Create/Configure Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Gmail API**

### 2. OAuth 2.0 Client Setup

1. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client IDs"
2. Set the application type to **"Web application"**
3. Add authorized redirect URIs:
   - `http://localhost:3000/api/google/callback`
   - `http://localhost:3000/api/google/incremental-scope`
   - Add production URLs as needed

### 3. OAuth Consent Screen

1. Configure the OAuth consent screen
2. Add the Gmail scope: `https://www.googleapis.com/auth/gmail.readonly`
3. For development, set to "Internal" users
4. For production, submit for verification if needed

## Required OAuth Scopes

The incremental auth system will request these scopes as needed:

- `openid` - Basic OpenID Connect
- `email` - User's email address
- `profile` - User's basic profile info
- `https://www.googleapis.com/auth/gmail.readonly` - Read Gmail messages (requested incrementally)

## Testing the Integration

1. Start the development server:

   ```bash
   npm run dev
   ```

2. Navigate to `/test-gmail` in your browser

3. Sign in with Google if not already authenticated

4. The page will check your current permissions and guide you through requesting Gmail access if needed

## How Incremental Auth Works

1. **Initial Auth**: User signs in with basic scopes (openid, email, profile)
2. **Scope Check**: When Gmail access is needed, the app checks current permissions
3. **Incremental Request**: If Gmail scope is missing, a popup requests additional permissions
4. **Token Update**: New tokens with additional scopes are stored in the user's account record
5. **Seamless Access**: Future requests use the updated tokens

## Troubleshooting

### Common Issues

1. **"OAuth Error: redirect_uri_mismatch"**
   - Check that your redirect URIs in Google Cloud Console match exactly
   - Make sure to include both `/google/callback` and `/google/incremental-scope` endpoints

2. **"Session mismatch" errors**
   - Ensure NEXTAUTH_SECRET is set and consistent
   - Check that the user is properly authenticated before requesting additional scopes

3. **"User account not found" errors**
   - Verify that the user has signed in with Google at least once
   - Check database connectivity and user account records

### Debug Mode

Enable debug logging by setting:

```bash
NODE_ENV=development
DEBUG=true
```

This will provide detailed console output for OAuth flows and token management.
