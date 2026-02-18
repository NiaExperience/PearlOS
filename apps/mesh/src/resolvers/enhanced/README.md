# NotionModel for Mesh Server

This module provides the Sequelize model definition for NotionModel, which represents the core data structure in the Nia application.

## Usage

```typescript
import { Sequelize } from 'sequelize';
import { createNotionModel } from './notion-model';

// Initialize Sequelize
const sequelize = new Sequelize('postgres://user:pass@localhost:5432/mydb');

// Create the NotionModel
const NotionModel = createNotionModel(sequelize);

// Now you can use NotionModel for queries
const records = await NotionModel.findAll({
  where: {
    type: 'User'
  }
});
```

## Data Structure

The NotionModel represents a block in the Notion-like data structure:

- `block_id`: Unique identifier for the block (UUID, primary key)
- `page_id`: The page this block belongs to (UUID)
- `parent_id`: The parent block if applicable (UUID, optional)
- `type`: The type of block (e.g., 'User', 'Assistant', 'DynamicContent')
- `content`: The JSON content of the block (stored as TEXT)
- `indexer`: Additional indexed fields for efficient querying (JSONB)
- `order`: Ordering within the parent block (optional)
- `version`: Schema version information (optional)

## Related Types

- `INotionModel`: Interface defining the NotionModel structure
- `NotionModelCreationAttributes`: Interface for creating new NotionModel instances
- `NotionBlockWithTimestamps`: Type that includes timestamp information
- `NotionPage<T>`: Interface representing a collection of blocks making up a logical "page"

## Important Notes

1. The model is designed to work with GraphQL Mesh for data access
2. The content field contains JSON-stringified data representing the actual block content
3. The indexer field contains JSON data for efficient querying with PostgreSQL JSONB features
