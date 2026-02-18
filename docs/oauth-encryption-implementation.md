# OAuth Token Encryption for Google App Verification

This document explains the encrypted storage implementation for OAuth tokens to meet Google's app verification requirements.

## Overview

To prepare for Google app verification, we've implemented **encrypted-at-rest storage** for OAuth tokens while maintaining full backward compatibility with existing data.

## What Changed

### 1. **Reduced Token Storage** (Google's Recommendation)

**Before** (stored everything):
```typescript
{
  refresh_token: "...",     // ✅ Keep - Essential for token refresh
  access_token: "...",      // ❌ Removed - Short-lived, regenerated
  expires_at: 1234567890,   // ✅ Keep - Essential for token management  
  scope: "gmail.readonly",  // ✅ Keep - Essential for permission tracking
  token_type: "Bearer",     // ❌ Removed - Always "Bearer", redundant
  id_token: "...",          // ❌ Removed - Contains user data, use immediately
  session_state: "...",     // ❌ Removed - Only needed during OAuth flow
}
```

**After** (only essentials):
```typescript
{
  refresh_token: "...",     // ✅ Essential for token refresh
  expires_at: 1234567890,   // ✅ Essential for token management
  scope: "gmail.readonly",  // ✅ Essential for permission tracking
}
```

### 2. **Encrypted Content Storage**

- **Account `content` field** is now encrypted using AES-256-CBC
- **Versioned encryption** format: `ENC_V1:{iv}:{encryptedData}`
- **Backward compatible** - existing unencrypted records still work
- **Gradual migration** - records encrypted on next update

### 3. **Implementation Details**

#### Content Encryption Flow:
```typescript
// On Write (AccountBlock.createBlocks)
const jsonContent = JSON.stringify(accountData);
const encrypted = ContentEncryption.secureContentForStorage(jsonContent);
// Stored: "ENC_V1:a1b2c3:d4e5f6..."

// On Read (parseBlockToData in notion-service)
const decrypted = ContentEncryption.decryptContent(storedContent);
const accountData = JSON.parse(decrypted);
// Result: Original account object
```

#### Backward Compatibility:
```typescript
// Reading legacy unencrypted record
ContentEncryption.decryptContent("{'provider':'google'}") 
// → Returns: "{'provider':'google'}" (unchanged)

// Reading new encrypted record  
ContentEncryption.decryptContent("ENC_V1:a1b2:c3d4...")
// → Returns: "{'provider':'google'}" (decrypted)
```

## Setup Instructions

### 1. **Generate Encryption Key**

```bash
# Run the setup script
node scripts/setup-oauth-encryption.mjs
```

This adds to your `.env.local`:
```bash
# OAuth Token Encryption (for encryption at rest)
TOKEN_ENCRYPTION_KEY=base64-encoded-32-byte-key
```

### 2. **Environment Variables**

The encryption uses your existing `TOKEN_ENCRYPTION_KEY` or does not encrypt.

```bash
# Primary (recommended)
TOKEN_ENCRYPTION_KEY=your-base64-encryption-key

# Fallback (if TOKEN_ENCRYPTION_KEY not set)
NEXTAUTH_SECRET=your-nextauth-secret
```

### 3. **Testing**

```bash
# Run encryption tests
npm test shared/__tests__/oauth-encryption.test.ts

# Verify your Gmail integration still works
npm run dev:interface
# Test: Say "Check my email" via VAPI
```

## Migration Behavior

### **Existing Records** (Gradual Migration)
- ✅ **Read**: Works immediately (backward compatible)
- ✅ **Update**: Automatically encrypted on next update
- ✅ **No downtime**: No database migration required

### **New Records** (Immediate Encryption)
- ✅ **OAuth signin**: New accounts immediately encrypted
- ✅ **Token refresh**: Updated tokens immediately encrypted
- ✅ **Scope updates**: Incremental auth immediately encrypted

## Security Benefits

### **For Google App Verification:**
1. **Data Minimization** - Only store essential OAuth data
2. **Encryption at Rest** - Sensitive tokens encrypted in database
3. **Best Practices** - Follows Google's security recommendations
4. **Audit Trail** - Clear encryption versioning for compliance

### **For Your Application:**
1. **Zero Breaking Changes** - Existing code continues to work
2. **Transparent Encryption** - No API changes required
3. **Automatic Migration** - Records updated as they're touched
4. **Future-Proof** - Versioned encryption for algorithm upgrades

## Files Modified

### **Core Implementation:**
- `shared/src/utils/encryption.ts` - ContentEncryption class
- `shared/src/blocks/account.block.ts` - Encrypt on storage  
- `shared/src/notion/notion-service.ts` - Decrypt on retrieval
- `shared/src/authOptions.ts` - Reduced token storage

### **Setup & Testing:**
- `scripts/setup-oauth-encryption.mjs` - Environment setup
- `shared/__tests__/oauth-encryption.test.ts` - Encryption tests

## Troubleshooting

### **"Encryption key not found" Error**
```bash
# Run setup script to generate key
node scripts/setup-oauth-encryption.mjs
```

### **"Failed to decrypt" Error**  
- Legacy record: Normal, will be migrated on next update
- New record: Check `TOKEN_ENCRYPTION_KEY` is correct

### **Gmail Integration Broken**
- Verify environment variables are set
- Check encryption key hasn't changed
- Test with: `npm test shared/__tests__/oauth-encryption.test.ts`

## Google App Verification Checklist

- ✅ **Minimal data storage** - Only essential OAuth fields
- ✅ **Encrypted at rest** - Sensitive tokens encrypted
- ✅ **No hardcoded secrets** - Environment-based encryption
- ✅ **Secure token handling** - Access tokens regenerated from refresh tokens
- ✅ **Data retention** - Removed unnecessary OAuth metadata
- ✅ **Backward compatibility** - No user impact during migration

Your OAuth implementation is now ready for Google app verification! 🚀
