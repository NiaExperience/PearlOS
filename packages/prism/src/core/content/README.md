# Dynamic Content Client-Side Utilities

This module provides client-safe utilities for working with dynamic content in the dashboard UI. These utilities use fetch API calls instead of direct server-side imports, making them safe for use in client components.

## Overview

The dynamic content system allows you to:
- Create and manage dynamic content type definitions
- Create, read, update, and delete content based on those definitions
- Build dynamic forms and views that adapt to the content type schema
- Validate data against the schema before submission

## Quick Start

### 1. Import the utilities

```typescript
import {
  dynamicContentClient,
  useDynamicContentDefinitions,
  useDynamicContent,
} from '@nia/shared/content';

// For dynamic content list/detail views:
import { DynamicContentListView, DynamicContentDetailView } from '@nia/prism/core/components';
```

### 2. Use React hooks for state management

```typescript
function MyComponent({ tenantId }: { tenantId: string }) {
  // Fetch available content type definitions
  const {
    definitions,
    loading,
    error,
    fetchDefinitions
  } = useDynamicContentDefinitions(tenantId);

  // Work with content for a specific definition
  const {
    content,
    createContent,
    updateContent,
    deleteContent
  } = useDynamicContent(definitionId);

  useEffect(() => {
    fetchDefinitions();
  }, [fetchDefinitions]);

  // ... rest of component
}
```

### 3. Use the list and detail view components

The following components are available in `prism/src/core/components`:

- **DynamicContentListView**: Renders a list/grid of content items for a given definition, using the shared ContentCard for each item.
- **DynamicContentDetailView**: Renders a detail view for a single content item, showing all or selected fields.

```typescript
import { DynamicContentListView, DynamicContentDetailView } from '@nia/prism/core/components';

function ContentList({ definition, items }) {
  return <DynamicContentListView definition={definition} items={items} />;
}

function ContentDetail({ definition, item }) {
  return <DynamicContentDetailView definition={definition} item={item} />;
}
```

These components use the shared `ContentCard` (in `shared/src/components/ui/content-card.tsx`) for consistent card rendering and theming.

## API Reference

### DynamicContentClient

The main client class for making API calls:

```typescript
const client = new DynamicContentClient({
  baseUrl: '', // Optional: base URL for API calls
  apiPrefix: '/api/dynamicContent' // Optional: API prefix
});
```

#### Methods

- `createDefinition(definition)` - Create a new content type definition
- `getDefinition(definitionId)` - Get a content type definition
- `listDefinitions(tenantId)` - List all definitions for a tenant
- `replaceDefinition(definition, definitionId)` - Replace a definition
- `deleteDefinition(blockType, definitionId)` - Delete a definition
- `createContent(data, definitionId, blockId)` - Create content
- `getContent(contentId, definitionId)` - Get content by ID
- `listContent(filter, definitionId)` - List content with optional filtering
- `updateContent(contentId, definitionId, data)` - Update content
- `deleteContent(contentId, definitionId)` - Delete content
- `searchContent(query, definitionId)` - Advanced content search

### React Hooks

#### useDynamicContentDefinitions(tenantId)

Manages dynamic content type definitions:

```typescript
const {
  definitions,        // Array of definition objects
  loading,           // Boolean loading state
  error,             // Error object if any
  fetchDefinitions,  // Function to fetch definitions
  createDefinition,  // Function to create definition
  replaceDefinition,  // Function to replace definition
  deleteDefinition   // Function to delete definition
} = useDynamicContentDefinitions(tenantId);
```

#### useDynamicContent(definitionId)

Manages content data for a specific definition:

```typescript
const {
  content,           // Array of content items
  loading,           // Boolean loading state
  error,             // Error object if any
  fetchContent,      // Function to fetch content
  createContent,     // Function to create content
  updateContent,     // Function to update content
  deleteContent,     // Function to delete content
  searchContent      // Function to search content
} = useDynamicContent(definitionId);
```

#### useDynamicContentItem(definitionId, contentId)

Manages a single content item:

```typescript
const {
  item,              // Single content item
  loading,           // Boolean loading state
  error,             // Error object if any
  fetchItem,         // Function to fetch item
  updateItem,        // Function to update item
  deleteItem         // Function to delete item
} = useDynamicContentItem(definitionId, contentId);
```

### Utility Functions

#### Validation

```typescript
import { validateContentData } from '@nia/shared/content';

const validation = validateContentData(data, definition.dataModel);
if (!validation.success) {
  console.log('Validation errors:', validation.errors);
}
```

#### Form Utilities

```typescript
import {
  getFieldTypeInfo,
  transformFormData,
  getDefaultValues,
  getFieldDisplayName
} from '@nia/shared/content';

// Get field information for rendering
const fieldInfo = getFieldTypeInfo(field);

// Transform form data to expected format
const transformedData = transformFormData(formData, fields);

// Get default values for a definition
const defaults = getDefaultValues(definition.dataModel.fields);

// Get human-readable field name
const displayName = getFieldDisplayName('firstName'); // "First Name"
```

## Examples

### Creating a Content Management Interface

```typescript
function ContentManager({ tenantId }: { tenantId: string }) {
  const { definitions, loading, fetchDefinitions } = useDynamicContentDefinitions(tenantId);
  const [selectedDefinition, setSelectedDefinition] = useState<string>('');

  useEffect(() => {
    fetchDefinitions();
  }, [fetchDefinitions]);

  return (
    <div>
      <h1>Content Manager</h1>
      
      {/* Definition Selector */}
      <select onChange={(e) => setSelectedDefinition(e.target.value)}>
        <option value="">Select content type...</option>
        {definitions.map(def => (
          <option key={def._id} value={def._id}>
            {def.name}
          </option>
        ))}
      </select>

      {/* Content List */}
      {selectedDefinition && (
        <DynamicContentListView
          definition={definitions.find(d => d._id === selectedDefinition)}
          items={/* fetch or pass content items here */}
        />
      )}
    </div>
  );
}
```

### Custom Form with Validation

You can still build custom forms using the provided utilities and hooks for more advanced use cases.

```typescript
function CustomContentForm({ definition, onSave }: {
  definition: DynamicContentBlock.IDynamicContent;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [formData, setFormData] = useState(getDefaultValues(definition.dataModel.fields));
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate data
    const validation = validateContentData(formData, definition.dataModel);
    if (!validation.success) {
      setErrors(validation.errors || {});
      return;
    }

    // Transform and save
    const transformedData = transformFormData(formData, definition.dataModel.fields);
    onSave(transformedData);
  };

  return (
    <form onSubmit={handleSubmit}>
      {Object.entries(definition.dataModel.fields).map(([fieldName, field]) => (
        <div key={fieldName}>
          <label>{getFieldDisplayName(fieldName)}</label>
          <input
            type={getFieldTypeInfo(field).inputType}
            value={formData[fieldName] as string}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              [fieldName]: e.target.value
            }))}
          />
          {errors[fieldName] && (
            <span className="error">{errors[fieldName][0]}</span>
          )}
        </div>
      ))}
      <button type="submit">Save</button>
    </form>
  );
}
```

## API Routes Required

To use these utilities, you'll need to create the following API routes in your dashboard:

- `GET /api/dynamicContent/definitions` - List definitions
- `POST /api/dynamicContent/definitions` - Create definition
- `GET /api/dynamicContent/definitions/[id]` - Get definition
- `PUT /api/dynamicContent/definitions/[id]` - Update definition
- `DELETE /api/dynamicContent/definitions/[id]` - Delete definition
- `GET /api/dynamicContent/content/[definitionId]` - List content
- `POST /api/dynamicContent/content/[definitionId]` - Create content
- `GET /api/dynamicContent/content/[definitionId]/[contentId]` - Get content
- `PUT /api/dynamicContent/content/[definitionId]/[contentId]` - Update content
- `DELETE /api/dynamicContent/content/[definitionId]/[contentId]` - Delete content
- `POST /api/dynamicContent/content/[definitionId]/search` - Search content

These routes should use the server-side actions from `shared/src/core/actions/dynamicContent-actions.ts` and `shared/src/content/actions.ts`.

## TypeScript Support

All utilities are fully typed with TypeScript. The main types are:

- `DynamicContentBlock.IDynamicContent` - Content type definition
- `FieldDefinition` - Field definition
- `Fields` - Collection of field definitions

## Error Handling

All functions return proper error objects that can be handled in your UI:

```typescript
try {
  const result = await createContent(data);
  // Handle success
} catch (error) {
  // Handle error - error.message contains the error details
  console.error('Failed to create content:', error.message);
}
```

## Best Practices

1. **Always validate data** before submitting to the server
2. **Use the React hooks** for state management instead of manual API calls
3. **Handle loading and error states** in your UI
4. **Use the list/detail view components** for quick prototyping
5. **Create custom forms** for more complex requirements
7. **Use proper error boundaries** in your React components 

## Content Actions

The module provides comprehensive content management functions:

- `createContent()` - Create new content records
- `getContent()` - Retrieve content by ID
- `updateContent()` - Update existing content
- `deleteContent()` - Delete content records
- `findContent()` - Search for content with flexible querying
