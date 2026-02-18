# Settings Panels - Stored Information Feature

This directory contains components and utilities for displaying and managing user profile metadata in the Settings panel.

## Overview

The "Stored Information" feature allows users to view, edit, add, and delete metadata associated with their user profile. This metadata can contain various types of information stored as key-value pairs, including:
- Simple strings
- Arrays (e.g., `["playing keyboards", "playing stringed instruments"]`)
- Objects (displayed as formatted JSON)
- Null/undefined values

**UI Theme:** All settings panels use the Pixelify Sans font from Google Fonts for a consistent pixelated aesthetic.

## Architecture

The feature is built with a clear separation of concerns across multiple files:

### Components & Files

#### 1. `SettingsPanels.tsx`
**Role:** Main orchestration component
- Manages the overall settings panel UI and navigation
- Handles which panel is currently open
- Uses `useUserProfileMetadata` hook to fetch metadata when "Stored Information" panel is opened
- Passes fetched data to `MetadataDisplay` component

**Key Responsibilities:**
- Panel state management
- Conditional data fetching (only when stored-information panel is open)
- Error and loading state handling

#### 2. `MetadataDisplay.tsx`
**Role:** Presentation component for metadata
- Displays metadata in a readable, formatted way
- Supports editing mode (when `readOnly={false}`)
- Handles different data types (strings, arrays, objects)
- Calls `onSave` callback when edits are saved

**Key Features:**
- **Read-only mode:** Displays metadata in a clean, form-like layout
- **Edit mode:** Allows in-place editing with appropriate input types
  - Arrays: Multi-line text input (one item per line)
  - Objects: JSON textarea with formatting
  - Strings/Numbers: Text input
- **Add new fields:** Users can add new metadata fields via form interface
- **Delete fields:** Users can delete fields with confirmation dialog
- **Batch save:** All changes are saved together via "Save All" button

**Props:**
- `metadata: Record<string, unknown>` - The metadata to display
- `onSave?: (updatedMetadata: Record<string, unknown>) => void` - Callback when edits are saved (used by Save All)
- `readOnly?: boolean` - Whether editing is enabled (default: `true`)

**Ref Methods:**
- `getCurrentMetadata()` - Returns current local metadata state (used by Save All)

#### 3. `useUserProfileMetadata.ts`
**Role:** Custom React hook for data fetching
- Encapsulates API call logic to fetch user profile metadata
- Manages loading and error states
- Only fetches when `enabled` parameter is `true`
- Returns `{ metadata, loading, error }`

**Usage:**
```typescript
const { metadata, userProfileId, loading, error, refresh } = useUserProfileMetadata(openPanel === 'stored-information');
```

**Returns:**
- `metadata: Record<string, unknown> | null` - The fetched metadata
- `userProfileId: string | null` - The user profile ID (needed for saving)
- `loading: boolean` - Loading state
- `error: string | null` - Error message if fetch fails
- `refresh: () => Promise<void>` - Manual refresh function

#### 4. `metadata-utils.ts`
**Role:** Utility functions for metadata manipulation
- `formatMetadataKey()` - Converts snake_case/camelCase keys to readable format
- `valueToEditString()` - Converts metadata values to editable string format
- `editStringToValue()` - Converts edit strings back to proper value types
- Type guards for arrays and objects

**Location:** `apps/interface/src/lib/metadata-utils.ts`

## Data Flow

```
SettingsPanels.tsx
    │
    ├─> useUserProfileMetadata (when panel opens)
    │   └─> Fetches from /api/userProfile?userId=...
    │
    └─> MetadataDisplay (receives metadata)
        ├─> Uses metadata-utils for formatting
        └─> onSave callback (when editing enabled)
            └─> Should call API to save updates
```

## How It Works

### 1. Display Mode

When a user opens the "Stored Information" panel:
1. `SettingsPanels` detects the panel is open
2. Calls `useUserProfileMetadata(true)` to fetch data
3. Hook makes API call to `/api/userProfile?userId={userId}`
4. Fetched metadata is passed to `MetadataDisplay`
5. Component formats and displays:
   - Arrays as bulleted lists
   - Objects as formatted JSON
   - Strings/numbers as plain text

### 2. Edit Mode

When `readOnly={false}` (edit mode enabled via "Edit" button in panel header):
1. Each field shows an "Edit" button next to the label
2. Clicking "Edit" switches to edit mode for that field
3. Arrays show as multi-line text input (one item per line)
4. Objects show as JSON textarea
5. Strings/Numbers show as text input
6. Individual field saves update local state only
7. "Save All" button saves all changes via API
8. Changes are persisted to `/api/userProfile` endpoint

### 3. Adding New Fields

1. Click "Add New Field" button (appears at bottom of field list)
2. Enter field name (e.g., `favorite_color`)
3. Enter field value (JSON or plain text)
4. Field is added to local metadata immediately
5. Click "Save All" to persist to database

### 4. Deleting Fields

1. Click the delete (X) button next to any field
2. Confirmation dialog appears with field name
3. Confirm deletion to remove field from local metadata
4. Click "Save All" to persist deletion to database

## Data Type Handling

### Arrays
**Display:** Bulleted list
```
• playing keyboards
• playing stringed instruments
```

**Edit:** Multi-line text input
```
playing keyboards
playing stringed instruments
```

**Storage:** `["playing keyboards", "playing stringed instruments"]`

### Objects
**Display:** Formatted JSON with syntax highlighting
```json
{
  "theme": "dark",
  "language": "en"
}
```

**Edit:** JSON textarea with validation

### Strings/Numbers
**Display:** Plain text
**Edit:** Text input

## API Integration

### Fetching Metadata
- **Endpoint:** `GET /api/userProfile?userId={userId}`
- **Response:** `{ items: [{ metadata: {...} }] }`

### Saving Metadata
- **Endpoint:** `PUT /api/userProfile`
- **Body:** `{ id: "<userProfileId>", metadata: { ... } }`
- **Response:** `{ success: true, data: userProfile }`
- Changes are batched and saved all at once via "Save All" button

## Example Usage

```tsx
// In SettingsPanels.tsx
const { metadata, userProfileId, loading, error, refresh } = useUserProfileMetadata(
  openPanel === 'stored-information'
);
const metadataDisplayRef = useRef<MetadataDisplayRef>(null);

// Save handler
const handleSaveMetadata = async () => {
  if (!userProfileId || !metadataDisplayRef.current) return;
  
  const currentMetadata = metadataDisplayRef.current.getCurrentMetadata();
  const response = await fetch('/api/userProfile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: userProfileId,
      metadata: currentMetadata
    })
  });
  
  if (response.ok) {
    await refresh(); // Refresh metadata after save
    setIsEditMode(false);
  }
};

// Pass to MetadataDisplay
<MetadataDisplay
  ref={metadataDisplayRef}
  metadata={metadata || {}}
  readOnly={!isEditMode}
/>
```

## UI Theming

All settings panels use **Pixelify Sans** font from Google Fonts for a consistent pixelated aesthetic:
- Settings modal header
- Navigation sidebar and menu items
- Profile Information panel
- Notifications panel
- Appearance panel
- Privacy & Security panel
- Contact Us panel
- Stored Information panel
- Profile dropdown menu

The font is loaded via Next.js font optimization and applied using CSS variables.

## Future Enhancements

1. **Validation:** Add validation for different data types during editing
2. **History:** Show edit history or allow reverting changes
3. **Bulk operations:** Select and edit/delete multiple fields at once
4. **Field reordering:** Allow users to reorder metadata fields
5. **Import/Export:** Allow importing/exporting metadata as JSON

## Testing

To test with a specific user's metadata:
1. Open Settings panel
2. Click "Stored Information"
3. Metadata will be fetched and displayed automatically

## File Structure

```
settings-panels/
├── README.md (this file)
├── SettingsPanels.tsx (main component)
├── MetadataDisplay.tsx (metadata display/edit component)
└── useUserProfileMetadata.ts (data fetching hook)

../lib/
└── metadata-utils.ts (utility functions)
```

## Notes

- All components are client-side (`'use client'`)
- Metadata is normalized by the API (handles legacy stringified JSON)
- The hook only fetches when the panel is open (performance optimization)
- Error and loading states are handled at the component level
- Changes are stored locally until "Save All" is clicked (batching)
- Delete operations require confirmation to prevent accidental loss
- Font is applied consistently across all settings UI for cohesive design

