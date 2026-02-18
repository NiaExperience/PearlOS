-- Fix nested metadata.metadata in UserProfile records
-- This script flattens metadata.metadata into metadata

-- First, let's see what we're dealing with
SELECT 
  id,
  content->>'email' as email,
  content->'metadata' as current_metadata,
  content->'metadata'->'metadata' as nested_metadata
FROM notion_blocks
WHERE type = 'UserProfile'
  AND content->'metadata' ? 'metadata';

-- Now fix it by flattening
UPDATE notion_blocks
SET content = jsonb_set(
  content,
  '{metadata}',
  (
    -- Merge top-level metadata keys (excluding 'metadata') with nested metadata keys
    SELECT jsonb_object_agg(key, value)
    FROM (
      -- Get all keys from top level EXCEPT 'metadata'
      SELECT key, value 
      FROM jsonb_each(content->'metadata') 
      WHERE key != 'metadata'
      
      UNION ALL
      
      -- Get all keys from nested 'metadata'
      SELECT key, value 
      FROM jsonb_each(content->'metadata'->'metadata')
    ) AS merged
  )
)
WHERE type = 'UserProfile'
  AND content->'metadata' ? 'metadata';

-- Verify the fix
SELECT 
  id,
  content->>'email' as email,
  content->'metadata' as fixed_metadata
FROM notion_blocks
WHERE type = 'UserProfile'
  AND content->>'email' LIKE '%@%'
LIMIT 5;
