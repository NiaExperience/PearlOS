// Auto-maintained minimal OpenAPI spec for Prism Mesh Content API (Phase 1)
// NOTE: In Phase 1 this is static; future phases may auto-generate.

import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

export const openapiRouter: Router = Router();

const spec = {
  openapi: '3.0.1',
  info: {
    title: 'Prism Mesh Content API',
    version: '1.0.0-phase1',
    description: `Lightweight REST wrapper for Prism content & definitions with advanced filtering.

## Brain-to-Mesh Integration

For Brain service calls, use service authentication:

\`\`\`
x-mesh-secret: <MESH_SHARED_SECRET>
Content-Type: application/json
\`\`\`

### Public Endpoints:
- \`GET /docs\` - Interactive Swagger UI documentation (no authentication required)
- \`GET /docs/docs.json\` - This OpenAPI specification (no authentication required)

### Environment Variables Required:
- \`MESH_SHARED_SECRET\` - Service authentication key

### Typical Brain Usage:
1. Get assistant by subdomain: \`GET /api/content/Assistant?where={"indexer":{"path":"subDomain","equals":"pearlos"}}\`
2. Create new content type definition: \`POST /api/definition\` with definition body
3. Update user data: \`PUT /api/content/User/{id}\` with content body

### Authentication Options:
1. **Service Secret** (recommended for Brain): \`x-mesh-secret\` header
2. **JWT Bearer Token**: \`Authorization: Bearer <jwt>\` for user-scoped calls

### Filter Examples:
- Assistant lookup: \`?where={"indexer":{"path":"subDomain","equals":"pearlos"}}\`
- Personality lookup: \`?where={"parent_id":{"eq":"some-tenant-id"}}\`
- User by email: \`?where={"indexer":{"path":"email","equals":"user@example.com"}}\`
- Active tools: \`?where={"status":{"eq":"active"}}\`
- Complex: \`?where={"and":[{"status":{"eq":"active"}},{"created_at":{"gte":"2025-01-01"}}]}\`
`
  },
  servers: [ { url: '/api' } ],
  components: {
    securitySchemes: {
      ServiceSecret: {
        type: 'apiKey',
        in: 'header',
        name: 'x-mesh-secret',
        description: 'Service-to-service authentication for trusted internal calls (Brain, Interface)'
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'User authentication via HS256 JWT with claims: sub (userId), tenant, roles, iat, exp'
      }
    },
    schemas: {
      SuccessEnvelope: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'object' },
          total: { type: 'integer', example: 0 },
          hasMore: { type: 'boolean', example: false }
        }
      },
      ErrorEnvelope: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              code: { type: 'string' },
              details: { type: 'object' }
            }
          }
        }
      }
    }
  },
  security: [
    { ServiceSecret: [] },
    { BearerAuth: [] }
  ],
  paths: {
    '/docs.json': {
      get: {
        summary: 'Get OpenAPI specification',
        description: 'Returns the complete OpenAPI/Swagger specification for this API (public endpoint)',
        tags: ['Documentation'],
        security: [], // Override global security - no auth required
        responses: {
          '200': {
            description: 'OpenAPI specification',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  description: 'OpenAPI 3.0.1 specification document'
                }
              }
            }
          }
        }
      }
    },
    '/definition/{type}': {
      get: {
        summary: 'Find definition by type',
        description: 'Retrieve a content definition schema by type name',
        parameters: [
          { name: 'type', in: 'path', required: true, schema: { type: 'string' }, description: 'Content type name' },
          { name: 'tenant', in: 'query', schema: { type: 'string' }, description: 'Tenant ID (optional, derived from auth if not provided)' }
        ],
        responses: {
          '200': { 
            description: 'Definition found',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/SuccessEnvelope' } } }
          },
          '404': { 
            description: 'Definition not found',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorEnvelope' } } }
          },
          '401': { description: 'Authentication required' },
          '403': { description: 'Access denied' }
        }
      }
    },
    '/definition': {
      post: {
        summary: 'Create definition',
        description: 'Create a new content definition schema',
        requestBody: { 
          required: true, 
          content: { 
            'application/json': { 
              schema: { 
                type: 'object', 
                properties: { 
                  definition: { type: 'object', description: 'IDynamicContent definition object' },
                  tenant: { type: 'string', description: 'Tenant ID (optional, derived from auth if not provided)' }
                }, 
                required: ['definition'] 
              },
              example: {
                definition: {
                  type: 'PhotoAlbum',
                  fields: [
                    { name: 'title', type: 'string', required: true },
                    { name: 'description', type: 'text' },
                    { name: 'photos', type: 'array' },
                    { name: 'status', type: 'string' }
                  ]
                }
              }
            } 
          } 
        },
        responses: { 
          '200': { 
            description: 'Definition created',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/SuccessEnvelope' } } }
          },
          '400': { description: 'Invalid definition data' },
          '401': { description: 'Authentication required' },
          '500': { description: 'Creation failed' }
        }
      }
    },
    '/content/{type}/{id}': {
      get: {
        summary: 'Get single content by page_id',
        parameters: [
          { name: 'type', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: { '200': { description: 'Content item' }, '404': { description: 'Not found' } }
      },
      put: {
        summary: 'Update content by page_id',
        parameters: [
          { name: 'type', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { content: { type: 'object' } }, required: ['content'] } } } },
        responses: { '200': { description: 'Updated content' }, '404': { description: 'Not found' } }
      },
      delete: {
        summary: 'Delete content by page_id',
        parameters: [
          { name: 'type', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } }
      }
    },
    '/content/{type}': {
      get: {
        summary: 'Query content list',
        description: 'Retrieve content items with advanced filtering capabilities',
        parameters: [
          { name: 'type', in: 'path', required: true, schema: { type: 'string' }, description: 'Content type name' },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 50 }, description: 'Max items to return' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Skip this many items' },
          { name: 'page_id', in: 'query', schema: { type: 'string' }, description: 'Shorthand filter by specific page_id' },
          { 
            name: 'where', 
            in: 'query', 
            schema: { type: 'string' }, 
            description: 'URL-encoded JSON filter object. Supports operators: eq, ne, in, nin, contains, lt, lte, gt, gte, between, and, or. Special indexer syntax: {"indexer":{"path":"field","equals":"value"}}',
            example: '{"indexer":{"path":"subDomain","equals":"pearlos"}}'
          }
        ],
        responses: { 
          '200': { 
            description: 'List of content items',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/SuccessEnvelope' } } }
          },
          '400': { description: 'Invalid query parameters or where clause' },
          '401': { description: 'Authentication required' }
        }
      },
      post: {
        summary: 'Create content',
        description: 'Create a new content item',
        parameters: [ 
          { name: 'type', in: 'path', required: true, schema: { type: 'string' }, description: 'Content type name' } 
        ],
        requestBody: { 
          required: true, 
          content: { 
            'application/json': { 
              schema: { 
                type: 'object', 
                properties: { 
                  content: { type: 'object', description: 'Content data matching the type definition' } 
                }, 
                required: ['content'] 
              },
              example: {
                content: {
                  title: 'Summer Vacation 2025',
                  description: 'Photos from our trip to the mountains',
                  photos: ['photo1.jpg', 'photo2.jpg', 'photo3.jpg'],
                  status: 'active'
                }
              }
            } 
          } 
        },
        responses: { 
          '200': { 
            description: 'Created content',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/SuccessEnvelope' } } }
          },
          '400': { description: 'Invalid content data' },
          '401': { description: 'Authentication required' }
        }
      }
    }
  }
};

openapiRouter.get('/docs.json', (_req, res) => {
  res.json(spec);
});

export { spec };
export default openapiRouter;
