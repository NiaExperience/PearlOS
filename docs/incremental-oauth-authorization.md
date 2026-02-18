# Incremental OAuth Authorization System

This system implements Google's recommended practice of incremental authorization, allowing you to request additional OAuth scopes from users as needed, rather than requesting all permissions upfront.

## Overview

The incremental authorization system provides:

- **Just-in-time permissions**: Request scopes only when specific features are needed
- **Better user experience**: Users understand why each permission is needed
- **Secure token management**: Automatic token refresh and scope combination
- **Cross-app support**: Works with interface and dashboard apps
- **React components**: Pre-built UI components for common use cases

## Architecture

### Core Components

1. **`IncrementalAuthService`** - Core service for managing OAuth flows
2. **`useIncrementalAuth`** - React hook for frontend integration
3. **Permission components** - Pre-built UI components for requesting permissions
4. **API routes** - Backend endpoints for handling OAuth flows

### Supported Scopes

The system includes predefined constants for common Google API scopes:

```typescript
import { GOOGLE_SCOPES } from '@nia/shared/oauth/incremental-auth.types';

// Email and profile
GOOGLE_SCOPES.EMAIL
GOOGLE_SCOPES.PROFILE

// Gmail
GOOGLE_SCOPES.GMAIL_READONLY
GOOGLE_SCOPES.GMAIL_SEND
GOOGLE_SCOPES.GMAIL_COMPOSE
GOOGLE_SCOPES.GMAIL_MODIFY

// Google Drive
GOOGLE_SCOPES.DRIVE_READONLY
GOOGLE_SCOPES.DRIVE_FILE
GOOGLE_SCOPES.DRIVE_FULL

// Google Calendar
GOOGLE_SCOPES.CALENDAR_READONLY
GOOGLE_SCOPES.CALENDAR_EVENTS
GOOGLE_SCOPES.CALENDAR_FULL

// YouTube, Contacts, Photos
GOOGLE_SCOPES.YOUTUBE_READONLY
GOOGLE_SCOPES.CONTACTS_READONLY
GOOGLE_SCOPES.PHOTOS_READONLY
```

## Setup

### 1. Environment Variables

Ensure your Google OAuth client is configured with the incremental auth redirect URI:

```bash
# Your existing OAuth credentials
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret

# App-specific credentials (optional)
GOOGLE_INTERFACE_CLIENT_ID=your_interface_client_id
GOOGLE_INTERFACE_CLIENT_SECRET=your_interface_client_secret
GOOGLE_DASHBOARD_CLIENT_ID=your_dashboard_client_id
GOOGLE_DASHBOARD_CLIENT_SECRET=your_dashboard_client_secret
```

### 2. Google Cloud Console Setup

Add these redirect URIs to your Google OAuth client:

```
http://localhost:3000/api/auth/callback/google-incremental  # Interface (dev)
http://localhost:4000/api/auth/callback/google-incremental  # Dashboard (dev)
https://your-domain.com/api/auth/callback/google-incremental  # Production
```

### 3. Enable Required APIs

In Google Cloud Console, enable the APIs for scopes you plan to request:

- Gmail API (for Gmail scopes)
- Google Drive API (for Drive scopes)
- Google Calendar API (for Calendar scopes)
- YouTube Data API v3 (for YouTube scopes)
- People API (for Contacts scopes)
- Photos Library API (for Photos scopes)

## Usage

### Backend Integration

#### Check User Permissions

```typescript
import { createIncrementalAuthService } from '@nia/shared/oauth/incremental-auth.service';
import { GOOGLE_SCOPES } from '@nia/shared/oauth/incremental-auth.types';

// Create service instance
const authService = createIncrementalAuthService('interface');

// Check if user has specific scopes
const hasGmailAccess = await authService.hasScopes(
  userId, 
  [GOOGLE_SCOPES.GMAIL_READONLY]
);

// Get missing scopes
const missingScopes = await authService.getMissingScopes(
  userId,
  [GOOGLE_SCOPES.GMAIL_READONLY, GOOGLE_SCOPES.DRIVE_READONLY]
);

// Get valid access token (auto-refreshes if needed)
const accessToken = await authService.getValidAccessToken(userId);
```

#### Request Additional Scopes

```typescript
// Generate authorization URL for new scopes
const { authUrl, state } = await authService.requestScopes(userId, [
  {
    scope: GOOGLE_SCOPES.GMAIL_READONLY,
    reason: 'Access your Gmail messages for email integration',
    required: true,
  }
], userEmail);

// Redirect user to authUrl or return it to frontend
```

### Frontend Integration

#### Using the React Hook

```typescript
import { useIncrementalAuth } from '../hooks/useIncrementalAuth';
import { GOOGLE_SCOPES } from '@nia/shared/oauth/incremental-auth.types';

function MyComponent() {
  const { 
    requestScopes, 
    checkScopes, 
    requestGmailAccess,
    requestDriveAccess,
    requestCalendarAccess,
    requestInProgress 
  } = useIncrementalAuth();

  const handleRequestGmail = async () => {
    await requestGmailAccess({
      onSuccess: (grantedScopes) => {
        console.log('✅ Gmail access granted:', grantedScopes);
        // Enable Gmail features
      },
      onError: (error) => {
        console.error('❌ Gmail access denied:', error);
        // Handle gracefully
      },
      onCancel: () => {
        console.log('🚫 User cancelled Gmail authorization');
      }
    });
  };

  // Check current permissions
  const checkCurrentPermissions = async () => {
    const status = await checkScopes([GOOGLE_SCOPES.GMAIL_READONLY]);
    console.log('❓ Has Gmail access:', status.hasScopes);
  };

  return (
    <div>
      <button onClick={handleRequestGmail} disabled={requestInProgress}>
        Enable Gmail Integration
      </button>
    </div>
  );
}
```

#### Using Pre-built Components

```typescript
import { 
  GmailPermissionCard, 
  DrivePermissionCard,
  CalendarPermissionCard,
  GooglePermissionManager 
} from '../components/incremental-auth-components';

function PermissionSettings() {
  return (
    <div className="space-y-6">
      {/* Individual permission cards */}
      <GmailPermissionCard
        onPermissionGranted={(scopes) => {
          // Enable Gmail features
          console.log('Gmail permissions:', scopes);
        }}
        onPermissionDenied={(error) => {
          // Handle denial
          console.error('Gmail denied:', error);
        }}
      />

      <DrivePermissionCard
        onPermissionGranted={(scopes) => {
          // Enable Drive features
        }}
        onPermissionDenied={(error) => {
          // Handle denial
        }}
      />

      {/* Or use the complete permission manager */}
      <GooglePermissionManager />
    </div>
  );
}
```

#### Custom Permission Requests

```typescript
import { ScopePermissionCard } from '../components/incremental-auth-components';
import { YouTube } from 'lucide-react';

function CustomPermission() {
  return (
    <ScopePermissionCard
      title="YouTube Integration"
      description="Access your YouTube data to show your playlists and subscriptions"
      icon={<YouTube />}
      scopes={[GOOGLE_SCOPES.YOUTUBE_READONLY]}
      onPermissionGranted={(scopes) => {
        // Enable YouTube features
      }}
      onPermissionDenied={(error) => {
        // Handle denial
      }}
    />
  );
}
```

## API Endpoints

The system automatically creates these API endpoints for each app:

### POST `/api/auth/request-scopes`

Request additional OAuth scopes.

**Request Body:**
```json
{
  "scopes": ["https://www.googleapis.com/auth/gmail.readonly"],
  "reason": "Access your Gmail for email integration"
}
```

**Response:**
```json
{
  "success": true,
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "incremental_auth_user123_1234567890",
  "hasPermissions": false
}
```

### GET `/api/auth/request-scopes?scopes=scope1,scope2`

Check current scope status.

**Response:**
```json
{
  "hasScopes": true,
  "grantedScopes": ["https://www.googleapis.com/auth/userinfo.email"],
  "missingScopes": ["https://www.googleapis.com/auth/gmail.readonly"]
}
```

### GET `/api/auth/callback/google-incremental`

Handles OAuth callback for incremental authorization.

## Error Handling

The system includes comprehensive error handling:

### Common Errors

- **`access_denied`**: User denied the permission request
- **`popup_blocked`**: Browser blocked the popup window
- **`session_mismatch`**: Security error - session doesn't match request
- **`invalid_grant`**: Token expired or invalid
- **`invalid_client`**: OAuth client configuration error

### Error Pages

- `/api/google/auth/error` - Displays user-friendly error messages
- `/api/google/auth/success` - Confirms successful authorization

### Graceful Degradation

```typescript
// Example: Gmail feature with graceful fallback
const enableGmailFeatures = async () => {
  const hasAccess = await authService.hasScopes(userId, [GOOGLE_SCOPES.GMAIL_READONLY]);
  
  if (hasAccess) {
    // Show full Gmail integration
    loadGmailMessages();
  } else {
    // Show simplified UI with permission request
    showGmailPermissionPrompt();
  }
};
```

## Security Considerations

1. **State Parameter Validation**: All requests include cryptographically secure state parameters
2. **Session Verification**: Callbacks verify the user session matches the request
3. **Minimum Scope Principle**: Only request scopes actually needed for features
4. **Token Expiration**: Automatic token refresh with proper error handling
5. **HTTPS Only**: Production deployments must use HTTPS

## Best Practices

### When to Request Scopes

**✅ Good:**
- When user clicks "Enable Gmail Integration"
- Before accessing a specific Google service
- In response to a clear user action

**❌ Avoid:**
- On initial login (request only basic scopes)
- Without clear user intent
- For features the user may never use

### User Experience

1. **Clear Explanations**: Always explain why you need each permission
2. **Progressive Disclosure**: Show one permission request at a time
3. **Graceful Handling**: Provide alternatives when permissions are denied
4. **Easy Revocation**: Link to Google Account permissions page

### Implementation

```typescript
// Good: Request scope when feature is needed
const handleViewEmails = async () => {
  const hasAccess = await checkScopes([GOOGLE_SCOPES.GMAIL_READONLY]);
  
  if (!hasAccess) {
    await requestGmailAccess({
      onSuccess: () => loadEmails(),
      onError: () => showEmailUnavailableMessage(),
    });
  } else {
    loadEmails();
  }
};

// Good: Batch related scopes together
const enableFullGmailIntegration = async () => {
  await requestScopes({
    scopes: [
      GOOGLE_SCOPES.GMAIL_READONLY,
      GOOGLE_SCOPES.GMAIL_SEND,
    ],
    reason: 'Full Gmail integration for reading and sending emails',
    onSuccess: (scopes) => enableAllGmailFeatures(scopes),
  });
};
```

## Testing

### Unit Tests

Test the core service methods:

```typescript
describe('IncrementalAuthService', () => {
  it('should check user scopes correctly', async () => {
    const service = createIncrementalAuthService('interface');
    const hasScopes = await service.hasScopes(userId, [GOOGLE_SCOPES.EMAIL]);
    expect(hasScopes).toBe(true);
  });

  it('should generate correct auth URLs', () => {
    const service = createIncrementalAuthService('interface');
    const url = service.generateIncrementalAuthUrl(
      userId,
      [GOOGLE_SCOPES.GMAIL_READONLY],
      'test_state'
    );
    expect(url).toContain('include_granted_scopes=true');
  });
});
```

### Integration Tests

Test the complete OAuth flow:

```typescript
describe('Incremental Auth Flow', () => {
  it('should complete authorization flow', async () => {
    // Mock OAuth responses
    fetchMock.mockResponseOnce(JSON.stringify({
      access_token: 'new_token',
      scope: 'email profile gmail.readonly',
    }));

    const service = createIncrementalAuthService('interface');
    const result = await service.handleIncrementalCallback(
      'auth_code',
      'incremental_auth_user123_1234567890',
      'user123'
    );

    expect(result.success).toBe(true);
    expect(result.grantedScopes).toContain(GOOGLE_SCOPES.GMAIL_READONLY);
  });
});
```

## Monitoring and Analytics

Track permission requests and user behavior:

```typescript
// Example analytics integration
const trackPermissionRequest = (scope: string, result: 'granted' | 'denied') => {
  analytics.track('oauth_permission_request', {
    scope,
    result,
    timestamp: new Date().toISOString(),
  });
};

// Use in permission handlers
await requestGmailAccess({
  onSuccess: (scopes) => {
    trackPermissionRequest('gmail', 'granted');
    enableGmailFeatures();
  },
  onError: (error) => {
    trackPermissionRequest('gmail', 'denied');
    handleGmailDenial(error);
  },
});
```

## Troubleshooting

### Common Issues

1. **"Popup blocked" errors**
   - Ensure popups are allowed for your domain
   - Consider using redirect flow for mobile devices

2. **"Invalid redirect URI" errors**
   - Verify redirect URIs in Google Cloud Console
   - Check for trailing slashes and HTTP vs HTTPS

3. **"Token expired" errors**
   - Implement automatic token refresh
   - Handle refresh token expiration gracefully

4. **"Scope not granted" errors**
   - Check if APIs are enabled in Google Cloud Console
   - Verify OAuth client has permission for requested scopes

### Debug Mode

Enable debug logging:

```typescript
// In development
const authService = createIncrementalAuthService('interface');
authService.enableDebugMode(); // If implemented

// Or set environment variable
process.env.OAUTH_DEBUG = 'true';
```

This system provides a comprehensive, secure, and user-friendly way to implement incremental OAuth authorization in your NIA Universal application.
