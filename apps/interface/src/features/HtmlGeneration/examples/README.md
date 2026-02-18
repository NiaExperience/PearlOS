# HtmlGeneration Examples

This directory contains example implementations of HtmlGeneration applications that demonstrate best practices and patterns for creating embedded web applications within the Prism ecosystem.

## Directory Structure

```
examples/
├── dogfood/           # Dog Feeding Tracker demo
│   ├── README.md      # Demo documentation and user stories
│   ├── architecture.md  # Technical architecture analysis
│   ├── content-type.ts  # Content type definition
│   ├── create-demo.ts   # Script to create the demo record
│   └── index.ts        # Main exports
└── README.md          # This file
```

## Available Examples

### 🐕 Dog Feeding Tracker (`./dogfood/`)

A complete pet care tracking application that demonstrates:

- **Real API Integration**: Live connection to Prism Mesh API
- **Content Definition Management**: Dynamic schema creation
- **CRUD Operations**: Create, read, update, delete feeding entries
- **Mobile-Responsive Design**: Works on all device sizes
- **Error Handling**: Graceful failure recovery
- **Real-Time Updates**: Live data synchronization

**Size**: ~22.7KB embedded HTML application  
**Framework**: Vanilla HTML/CSS/JavaScript (no dependencies)

#### Quick Start

1. **Start the mesh server**:
   ```bash
   cd apps/mesh && npm start
   ```

2. **Run the demo creation script**:
   ```bash
   npx ts-node apps/interface/src/features/HtmlGeneration/examples/dogfood/create-demo.ts
   ```

3. **View the created app** in the HtmlGeneration interface

4. **Clean up demo data** (when done):
   ```bash
   npx ts-node apps/interface/src/features/HtmlGeneration/examples/dogfood/cleanup-demo.ts
   ```

#### Files

- `content-type.ts` - Defines the `DogFeedingEntry` schema and user-specific content type generation
- `create-demo.ts` - Creates the HtmlGeneration record with embedded app
- `cleanup-demo.ts` - Removes all demo data from the database
- `README.md` - User stories and demo objectives
- `architecture.md` - Technical architecture deep dive
- `index.ts` - Exports for programmatic usage

#### Cleanup

The cleanup script provides safe removal of all demo data:

```bash
# Interactive cleanup with confirmation
npx ts-node apps/interface/src/features/HtmlGeneration/examples/dogfood/cleanup-demo.ts

# Force cleanup without confirmation (use with caution)
npx ts-node apps/interface/src/features/HtmlGeneration/examples/dogfood/cleanup-demo.ts --force

# Cleanup with custom tenant/user IDs
npx ts-node apps/interface/src/features/HtmlGeneration/examples/dogfood/cleanup-demo.ts --tenant-id=custom-tenant --user-id=custom-user
```

The cleanup script removes:
- All feeding entry records created by the user
- The user-specific content type definition (`dogfood-<userId>`)
- All HtmlGeneration records with title "Dog Feeding Tracker"

**Note**: The cleanup is user-scoped, so it only removes data created by the specified user ID.

## Usage Patterns

### Importing Example Components

```typescript
// Import content type functions (user-specific)
import { 
  DOG_FEEDING_ENTRY_CONTENT_TYPE, 
  createDogFeedingContentType 
} from './dogfood/content-type';

// Import demo creation functions
import { 
  createHtmlGenerationRecord, 
  createDogFeedingTrackerHTML 
} from './dogfood/create-demo';

// Import everything from an example
import { 
  DOG_FEEDING_ENTRY_CONTENT_TYPE, 
  createDogFeedingContentType,
  createHtmlGenerationRecord,
  createDogFeedingTrackerHTML
} from './dogfood';

// Create user-specific content types to prevent namespace collisions
const userId = 'user-123';
const userContentType = createDogFeedingContentType(userId);
const userHTML = createDogFeedingTrackerHTML(`dogfood-${userId}`);
```

### Running Demo Scripts

```bash
# Run from project root
npx ts-node apps/interface/src/features/HtmlGeneration/examples/dogfood/create-demo.ts

# With custom tenant/user IDs
npx ts-node apps/interface/src/features/HtmlGeneration/examples/dogfood/create-demo.ts --tenant-id=custom-tenant --user-id=custom-user
```

## Creating New Examples

When adding new examples, follow this structure:

1. **Create example directory**: `examples/your-example-name/`
2. **Add required files**:
   - `content-type.ts` - Schema definitions
   - `create-demo.ts` - Demo creation script
   - `README.md` - Documentation
   - `index.ts` - Exports
3. **Optional files**:
   - `architecture.md` - Technical deep dive
   - `tests/` - Unit tests
   - `assets/` - Static assets

### Example Template

```typescript
// content-type.ts
import { IDynamicContent } from '@nia/prism/core/blocks/dynamicContent.block';

export const YOUR_CONTENT_TYPE: IDynamicContent = {
  name: 'your-content-type',
  description: 'Description of your content type',
  dataModel: {
    block: 'YourBlockType',
    jsonSchema: {
      // Your schema here
    }
  },
  // ... rest of definition
};

// create-demo.ts
import { ContentActions } from '@nia/prism/core/actions';
import { YOUR_CONTENT_TYPE } from './content-type';

const YOUR_HTML_APP = `<!DOCTYPE html>
<!-- Your embedded app HTML here -->
</html>`;

export async function createYourDemo() {
  // Demo creation logic
}

// index.ts
export { YOUR_CONTENT_TYPE } from './content-type';
export { createYourDemo, YOUR_HTML_APP } from './create-demo';
```

## Best Practices

### Content Type Design
- Keep schemas simple and AI-friendly
- Use descriptive field names and descriptions
- Include proper validation and constraints
- Design for extensibility

### Embedded App Architecture
- Use vanilla JavaScript for minimal footprint
- Include all styles and scripts inline
- Design for iframe isolation
- Implement proper error handling
- Design mobile-first responsive layouts

### API Integration
- Use the Applet API (`/api/applet-api`) for all operations
- Implement proper authentication patterns
- Handle network failures gracefully
- Cache data locally when appropriate

### Security Considerations
- Never expose sensitive credentials in embedded apps
- Validate all user inputs
- Use proper CORS policies
- Implement rate limiting where needed

## Contributing

When contributing new examples:

1. Follow the established directory structure
2. Include comprehensive documentation
3. Test with real data and API connections
4. Include error handling and edge cases
5. Optimize for performance and user experience
6. Update this README with your example

## Dependencies

Examples may require:
- Running mesh server (`apps/mesh`)
- Valid environment variables in `.env.local`
- Proper tenant and user authentication
- Network access to Prism APIs
