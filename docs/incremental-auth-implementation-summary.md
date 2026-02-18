# Incremental OAuth Scope Request Implementation Summary

Based on Google's incremental authorization documentation and your NIA Universal application architecture, I've implemented a comprehensive system for requesting additional OAuth scopes as needed.

## ✅ What's Been Implemented

### 1. Core Infrastructure

- **`IncrementalAuthService`** - Core service class handling OAuth flows
- **Type definitions** - Complete TypeScript interfaces for all components
- **Google scope constants** - Predefined scopes for common Google APIs
- **Multi-app support** - Works with interface and dashboard

### 2. Backend API Routes

- **`/api/auth/request-scopes`** - Request additional scopes endpoint
- **`/api/auth/callback/google-incremental`** - OAuth callback handler
- **Scope checking** - Check current user permissions
- **Token management** - Automatic refresh and scope combination

### 3. Frontend Components

- **`useIncrementalAuth`** - React hook for easy integration
- **Permission cards** - Pre-built UI components for Gmail, Drive, Calendar
- **Permission manager** - Complete permission management interface
- **Success/Error pages** - User-friendly OAuth flow completion pages

### 4. Security Features

- **State parameter validation** - Prevents CSRF attacks
- **Session verification** - Ensures request matches current user
- **Secure token storage** - Uses existing AccountBlock structure
- **Popup handling** - Secure popup-based OAuth flow

## 🔧 Key Features

### Incremental Authorization

Following Google's best practices, the system:

- Requests `include_granted_scopes: true` to combine new and existing scopes
- Only prompts for additional permissions when specific features are needed
- Maintains existing permissions when adding new ones
- Provides clear explanations for why each permission is needed

### User Experience

- **Contextual requests** - Permissions requested only when features are used
- **Clear explanations** - Users understand why each permission is needed
- **Graceful fallback** - Features degrade gracefully when permissions are denied
- **Easy revocation** - Links to Google Account permissions management

### Developer Experience

- **Simple API** - Easy-to-use React hooks and service methods
- **Pre-built components** - Ready-to-use permission request UI
- **Type safety** - Full TypeScript support
- **Error handling** - Comprehensive error states and recovery

## 📁 File Structure

```
shared/src/oauth/
├── incremental-auth.types.ts      # Type definitions and scope constants
└── incremental-auth.service.ts    # Core service implementation

apps/interface/src/
├── hooks/
│   └── useIncrementalAuth.ts      # React hook for frontend
├── components/
│   ├── incremental-auth-components.tsx  # Pre-built UI components
│   └── gmail-view-with-auth.tsx   # Example Gmail integration
├── app/
│   ├── api/auth/
│   │   ├── request-scopes/route.ts
│   │   └── callback/google-incremental/route.ts
│   └── auth/
│       ├── success/page.tsx       # Success page
│       ├── error/page.tsx         # Error page
│       └── permissions/page.tsx   # Permission management page

docs/
└── incremental-oauth-authorization.md  # Complete documentation
```

## 🚀 How to Use

### Basic Integration

```typescript
// 1. Check if user has permission
import { useIncrementalAuth } from '../hooks/useIncrementalAuth';

const { checkScopes, requestGmailAccess } = useIncrementalAuth();

// 2. Request permission when needed
await requestGmailAccess({
  onSuccess: (scopes) => {
    // Enable Gmail features
    loadGmailData();
  },
  onError: (error) => {
    // Handle gracefully
    showAlternativeOptions();
  }
});
```

### Pre-built Components

```typescript
// Use ready-made permission cards
import { GmailPermissionCard } from '../components/incremental-auth-components';

<GmailPermissionCard
  onPermissionGranted={(scopes) => enableGmailFeatures()}
  onPermissionDenied={(error) => handleGracefully()}
/>
```

### Backend API

```typescript
// Check permissions server-side
import { createIncrementalAuthService } from '@nia/shared/oauth/incremental-auth.service';

const authService = createIncrementalAuthService('interface');
const hasGmailAccess = await authService.hasScopes(userId, [GOOGLE_SCOPES.GMAIL_READONLY]);
```

## 🔄 OAuth Flow

1. **User triggers feature** that needs additional permissions
2. **Check current scopes** to see if permission already exists
3. **Generate auth URL** with `include_granted_scopes: true`
4. **Open popup** with Google OAuth consent screen
5. **Handle callback** and update user's token with combined scopes
6. **Notify frontend** of success/failure
7. **Enable features** based on granted permissions

## 📊 Supported Scopes

The system includes constants for common Google API scopes:

- **Gmail**: Read, send, compose, modify
- **Drive**: Read-only, file access, full access
- **Calendar**: Read-only, events, full access
- **YouTube**: Read-only access
- **Contacts**: Read-only access
- **Photos**: Read-only access

## 🔐 Security Considerations

- **Minimum scope principle** - Only request what's actually needed
- **State parameter validation** - Prevents CSRF attacks
- **Session verification** - Ensures callback matches current user
- **Token refresh** - Automatic token renewal when expired
- **HTTPS requirement** - Production deployments must use HTTPS

## 📋 Next Steps

### 1. Environment Setup

Add incremental auth redirect URIs to your Google Cloud Console:
```
https://your-domain.com/api/auth/callback/google-incremental
```

### 2. Integration Points

Replace existing permission-requiring features with incremental auth:

- **Gmail view** - Use `GmailViewWithAuth` component
- **Drive integration** - Request Drive scopes before accessing files
- **Calendar features** - Request Calendar scopes for event access

### 3. API Implementation

Once you have Gmail scope, you can implement actual Gmail API calls:

```typescript
// Example: Fetch user's emails
const accessToken = await authService.getValidAccessToken(userId);
const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
  },
});
```

### 4. Feature-Specific Implementation

For each Google service integration:

1. **Check permissions** before attempting API calls
2. **Request incrementally** when features are first used
3. **Handle gracefully** when permissions are denied
4. **Provide alternatives** for users who don't grant permissions

## 🎯 Benefits

### For Users
- **Better privacy** - Only grant permissions for features they actually use
- **Clear understanding** - Know exactly why each permission is needed
- **Gradual onboarding** - Not overwhelmed with permission requests at signup
- **Easy management** - Can revoke specific permissions as needed

### For Developers
- **Better conversion** - Users more likely to grant contextual permissions
- **Clearer feature adoption** - Track which permissions users actually want
- **Easier maintenance** - Modular permission system
- **Future-proof** - Easy to add new Google service integrations

### For the Application
- **Compliance** - Follows Google's recommended best practices
- **Security** - Minimum necessary permissions at all times
- **Scalability** - Easy to add new Google API integrations
- **User trust** - Transparent permission management builds confidence

This implementation provides a solid foundation for incremental OAuth scope requests that can grow with your application's needs while maintaining excellent security and user experience.
