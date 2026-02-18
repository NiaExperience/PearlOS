# Metadata Deletion Test Scenarios

## Scenario 1: Settings Dialog (UI)

**Initial State:**
```json
{
  "metadata": {
    "dogs": {"name": "Fido", "age": 5},
    "cats": {"name": "Whiskers"},
    "birds": {"name": "Tweety"}
  }
}
```

**User Action:**
- Opens Settings → Stored Information
- Clicks delete on "birds" key
- Clicks "Save Your Information"

**Expected Flow:**
1. MetadataDisplay: `delete updatedMetadata["birds"]`
2. Local state: `{ dogs: {...}, cats: {...} }` (birds removed)
3. SettingsPanels.handleSaveMetadata():
   - Fetches full UserProfile
   - Calls PUT with `metadataOperation: "REPLACE"`
4. UserProfile route (PUT_impl):
   - Passes `metadataOperation: "REPLACE"` to `createOrUpdateUserProfile`
5. createOrUpdateUserProfile (line 300):
   - `metadataOperation === MetadataOperation.REPLACE`
   - Line 358: `mergedMetadata = normalizeMetadata(metadata)`
   - Sets metadata to exact incoming object (no merge)
6. Line 390: `prism.update(UserProfileDefinition.dataModel.block, updatedRecord._id, updatedRecord)`
7. NotionModelResolver:
   - Receives: `{ metadata: { dogs: {...}, cats: {...} } }` (no birds)
   - Updates: `content = content || '{"metadata": {...}}'::jsonb`
   - PostgreSQL shallow merge: top-level content.* keys merge
   - **metadata key is replaced entirely**

**Expected Result:** ✅ Birds is deleted

---

## Scenario 2: Bot API (bot_delete_profile_metadata)

**Initial State:**
```json
{
  "metadata": {
    "dogs": {"name": "Fido", "age": 5},
    "cats": {"name": "Whiskers"},
    "birds": {"name": "Tweety"}
  }
}
```

**Bot Action:**
```python
await bot_delete_profile_metadata({
  "user_id": "user123",
  "keys_to_delete": ["birds"]
})
```

**Expected Flow:**
1. profile_tools.py (line 180):
   - Calls `profile_actions.delete_profile_metadata_keys`
2. profile_actions.py (line 295):
   - Fetches existing UserProfile
   - Gets metadata: `{ dogs: {...}, cats: {...}, birds: {...} }`
   - Removes key: `metadata.pop("birds", None)`
   - Result: `{ dogs: {...}, cats: {...} }`
3. Sends PATCH to `/content/UserProfile/{id}`:
   ```json
   {
     "content": {
       "metadata": { "dogs": {...}, "cats": {...} }
     }
   }
   ```
4. Mesh contentApi.ts (line 440):
   - Receives PATCH request
   - Calls `prism.update(UserProfile, id, { metadata: {...} }, tenant)`
5. NotionModelResolver:
   - Receives: `{ metadata: { dogs: {...}, cats: {...} } }`
   - Updates: `content = content || '{"metadata": {...}}'::jsonb`
   - PostgreSQL shallow merge: top-level content.* keys merge
   - **metadata key is replaced entirely**

**Expected Result:** ✅ Birds is deleted

---

## Key Insight

Both workflows work correctly because:

1. **Settings Dialog (REPLACE mode):**
   - Sends complete metadata object with deleted keys removed
   - Uses REPLACE operation to bypass merge logic entirely
   - Result: metadata = exactly what was sent

2. **Bot API (default MERGE mode):**
   - Fetches existing, removes keys locally, sends modified complete object
   - Even though it uses MERGE mode in createOrUpdateUserProfile...
   - The action sends the full UserProfile record (line 390)
   - NotionModelResolver sees `{ metadata: {...} }` as a content field update
   - PostgreSQL `||` does shallow merge: content.metadata is replaced entirely

**Both achieve deletion through replacement at the metadata level.**

---

## Potential Issues to Verify

### Issue 1: Bot sends via Mesh PATCH, not UserProfile PATCH
- Bot uses: `/content/UserProfile/{id}` → Mesh contentApi
- UI uses: `/api/userProfile` → UserProfile route
- **Different code paths!**

### Issue 2: UserProfile action line 390
```typescript
await prism.update(UserProfileDefinition.dataModel.block, updatedRecord._id, updatedRecord);
```
- Sends entire updatedRecord (all fields)
- Includes: `{ first_name, email, userId, metadata, ... }`
- NotionModelResolver handles this as content update

### Issue 3: Mesh PATCH line 469
```typescript
const updated = await prism.update(type, id, content, tenant);
```
- Only sends the `content` field from request body
- Bot sends: `{ content: { metadata: {...} } }`
- So prism.update receives: `{ metadata: {...} }`

**Different data structures!**

---

## Test Verification Needed

1. ✅ Verify Settings Dialog deletion works
2. ✅ Verify bot metadata deletion works
3. ✅ Verify both paths actually delete keys from database
4. ⚠️  Check if there are any race conditions or caching issues
