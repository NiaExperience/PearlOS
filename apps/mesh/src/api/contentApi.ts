/* eslint-disable @typescript-eslint/no-explicit-any */

import { Prism } from '@nia/prism';
import express from 'express';

const DEBUG_CONTENT_API = process.env.MESH_CONTENT_API_DEBUG === 'true';
const debug = (...args: any[]) => {
  if (!DEBUG_CONTENT_API) return;
  console.debug('[contentApi]', ...args);
};

// Allowed filter operators for validation (aligned with GraphQL filters)
const ALLOWED_OPS = new Set([
  'eq','equals','ne','in','nin','contains','containedBy','lt','lte','gt','gte','between','and','or',
  'like','startsWith','endsWith',
  'hasKey','hasAnyKeys','hasAllKeys','has','hasSome','hasEvery','hasNone','typed'
]);

function validatePredicate(obj: any): boolean {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return false;
  for (const [k,v] of Object.entries(obj)) {
    if (k === 'and' || k === 'or') {
      if (!Array.isArray(v) || v.length === 0) return false;
      for (const child of v as any[]) {
        if (!validatePredicate(child)) return false;
      }
      continue;
    }
    if (!ALLOWED_OPS.has(k)) return false;
    if (k === 'between') {
      if (!Array.isArray(v) || v.length !== 2) return false;
    }
    // other operators accept any JSON value / array; deeper validation left to Prism or DB layer
  }
  return true;
}



// Normalize case: convert lowercase and/or to uppercase AND/OR for GraphQL
function normalizeCaseRecursive(obj: any): any {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  
  const normalized: any = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key === 'and' || key === 'AND') {
      normalized['AND'] = Array.isArray(val) ? val.map(normalizeCaseRecursive) : val;
    } else if (key === 'or' || key === 'OR') {
      normalized['OR'] = Array.isArray(val) ? val.map(normalizeCaseRecursive) : val;
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      normalized[key] = normalizeCaseRecursive(val);
    } else {
      normalized[key] = val;
    }
  }
  return normalized;
}


function parseWhere(raw: string | undefined, res: express.Response) {
  if (!raw) return undefined;
  try {
    const decoded = JSON.parse(raw);
    if (decoded == null || typeof decoded !== 'object' || Array.isArray(decoded)) {
      fail(res, 400, 'where must be a JSON object', 'BAD_WHERE');
      return Symbol.for('error');
    }
    // Validate recursively by wrapping in a root AND (synthetic) if necessary
    // Accept top-level shape: { field: { op: value }, and:[...], or:[...] }
    // We'll inspect each value; if value is an object whose keys are operators we validate those
    const inspectStack: any[] = [decoded];
    while (inspectStack.length) {
      const node = inspectStack.pop();
      for (const [key,val] of Object.entries(node)) {
        // Accept both lowercase (and/or) and uppercase (AND/OR) for logical operators
        if (key === 'and' || key === 'or' || key === 'AND' || key === 'OR') {
          if (!Array.isArray(val) || val.length === 0) return fail(res, 400, `${key} must be non-empty array`, 'BAD_WHERE') && Symbol.for('error');
          for (const child of val as any[]) {
            if (child == null || typeof child !== 'object' || Array.isArray(child)) return fail(res, 400, `${key} entries must be objects`, 'BAD_WHERE') && Symbol.for('error');
            inspectStack.push(child);
          }
        } else if (key === 'indexer') {
          if (!val || typeof val !== 'object' || Array.isArray(val)) return fail(res, 400, 'indexer must be object', 'BAD_WHERE') && Symbol.for('error');
          const path = (val as any).path;
          if (typeof path !== 'string' || !path) return fail(res, 400, 'indexer.path required', 'BAD_WHERE') && Symbol.for('error');

          // Validate at least one supported operator is present
          const allowedIndexerOps = new Set([
            'eq','equals','ne','contains','containedBy','hasKey','hasAnyKeys','hasAllKeys','has','hasSome','hasEvery','hasNone','typed'
          ]);
          const opEntries = Object.entries(val as any).filter(([op]) => op !== 'path');
          if (opEntries.length === 0) return fail(res, 400, 'indexer requires an operator', 'BAD_WHERE') && Symbol.for('error');
          for (const [op, opVal] of opEntries) {
            if (!allowedIndexerOps.has(op)) return fail(res, 400, `indexer.${op} not supported`, 'BAD_WHERE') && Symbol.for('error');
            if (op !== 'typed' && opVal === undefined) return fail(res, 400, `indexer.${op} value required`, 'BAD_WHERE') && Symbol.for('error');
          }
        } else if (val && typeof val === 'object' && !Array.isArray(val)) {
          // treat as operator object
          if (!validatePredicate(val)) return fail(res, 400, `Invalid operators for field ${key}`, 'BAD_WHERE') && Symbol.for('error');
        } else {
          // Primitive equality shorthand -> convert to { eq: value }
          node[key] = { eq: val };
        }
      }
    }
    
    // Return normalized version with uppercase AND/OR
    return normalizeCaseRecursive(decoded);
  } catch (e: any) {
    fail(res, 400, 'Invalid where JSON', 'BAD_WHERE', e instanceof Error ? e.message : String(e));
    return Symbol.for('error');
  }
}

function ok(res: express.Response, data: any, meta: any = {}) {
  const payload: any = { success: true, data };
  if (typeof meta.total === 'number') payload.total = meta.total;
  if (typeof meta.hasMore === 'boolean') payload.hasMore = meta.hasMore;
  return res.json(payload);
}

function fail(res: express.Response, status: number, message: string, code?: string, details?: any) {
  console.error(`[contentApi.fail] Sending error response: status=${status}, code=${code}, message=${message}`);
  return res.status(status).json({ success: false, error: { message, code, details } });
}

export const contentApiRouter: express.Router = express.Router();

contentApiRouter.use(express.json());

contentApiRouter.get('/definition/:type', async (req: express.Request, res: express.Response) => {
  try {
    const { type } = req.params;
    const tenant = req.auth?.user?.tenant || (req.query.tenant as string) || 'any';

    debug('GET [/definition/:type] request:', { type, tenant, query: req.query });
    
    // TODO: Add tenant authorization validation
    // - Verify user has permission to access definitions for this tenant
    // - Check if user is member of tenant or has admin role
    // - For service-to-service calls (x-mesh-secret), allow broader access
    
    const prism = await Prism.getInstance();
    const result = await prism.findDefinition(type, tenant);

    if (!result || result.total === 0) {
      console.error(`Definition not found: type=${type}, tenant=${tenant}`);
      return fail(res, 404, 'Definition not found', 'NOT_FOUND');
    }
    
    ok(res, result.items[0], result.total);
  } catch (error) {
    console.error('Definition fetch error:', error);
    fail(res, 500, 'Failed to fetch definition', 'FETCH_ERROR', { error: String(error) });
  }
});

contentApiRouter.post('/definition', async (req: express.Request, res: express.Response) => {
  try {
    const { definition } = req.body || {};
    const tenant = req.auth?.user?.tenant || (req.query.tenant as string) || 'any';

    debug('POST [/definition] request:', { tenant, body: req.body });

    // TODO: Add admin authorization check for definition creation
    // - Verify user has admin or definition-create permissions
    // - Check if user can create definitions in the target tenant
    // - For service-to-service calls (x-mesh-secret), allow broader access
    
    if (!definition) {
      console.error('Missing definition payload');
      return fail(res, 400, 'Missing definition payload', 'MISSING_DEFINITION');
    }
    
    // Validate DynamicContent structure
    if (typeof definition !== 'object' || !definition) {
      console.error('Invalid definition structure');
      return fail(res, 400, 'Definition must be an object', 'INVALID_DEFINITION_TYPE');
    }
    
    // Required fields for DynamicContent
    const requiredFields = ['name', 'dataModel'];
    for (const field of requiredFields) {
      if (!definition[field]) {
        console.error(`Missing required field: ${field}`);
        return fail(res, 400, `Missing required field: ${field}`, 'MISSING_REQUIRED_FIELD');
      }
    }
    
    // Validate dataModel structure
    const { dataModel } = definition;
    if (typeof dataModel !== 'object' || !dataModel) {
      console.error('Invalid dataModel structure');
      return fail(res, 400, 'dataModel must be an object', 'INVALID_DATA_MODEL');
    }
    
    if (!dataModel.block || typeof dataModel.block !== 'string') {
      console.error('Invalid dataModel.block');
      return fail(res, 400, 'dataModel.block must be a string', 'INVALID_BLOCK');
    }
    
    if (!dataModel.jsonSchema || typeof dataModel.jsonSchema !== 'object') {
      console.error('Invalid dataModel.jsonSchema');
      return fail(res, 400, 'dataModel.jsonSchema must be an object', 'INVALID_JSON_SCHEMA');
    }
    
    // Validate jsonSchema basic structure
    if (dataModel.jsonSchema.type !== 'object') {
      console.error('Invalid jsonSchema.type');
      return fail(res, 400, 'jsonSchema.type must be "object"', 'INVALID_SCHEMA_TYPE');
    }
    
    if (!dataModel.jsonSchema.properties || typeof dataModel.jsonSchema.properties !== 'object') {
      console.error('Invalid jsonSchema.properties');
      return fail(res, 400, 'jsonSchema.properties must be an object', 'INVALID_SCHEMA_PROPERTIES');
    }

    // Require a tenant to create a definition in this API
    if (!tenant) {
      console.error('Missing tenant information');
      return fail(res, 403, 'Missing tenant information', 'MISSING_TENANT');
    }

    const prism = await Prism.getInstance();
    const created = await prism.createDefinition(definition, tenant);
    if (!created || created.total === 0) {
      console.error('Definition create failed');
      return fail(res, 500, 'Definition create failed', 'DEF_CREATE_FAIL');
    }
    return ok(res, created.items[0]);
  } catch (e: any) {
    console.error('Definition create error:', e);
    return fail(res, 500, 'Internal error', 'DEF_CREATE_ERR');
  }
});

contentApiRouter.get('/content/:type/:id', async (req: express.Request, res: express.Response) => {
  try {
    const { type, id } = req.params;
    const tenant = req.auth?.user?.tenant || (req.query.tenant as string) || 'any';

    debug('GET [/content/:type/:id] request:', { type, id, tenant });

    // TODO: Add content access authorization
    // - Verify user has read access to content in this tenant
    // - Check if content belongs to user's accessible tenants
    // - Apply row-level security based on user roles and content ownership

    if (!type || !id) {
      console.error('GET [/content/:type/:id] Missing type or id');
      return fail(res, 400, 'Missing type or id');
    }
    const prism = await Prism.getInstance();
    const result = await prism.query({
      contentType: type,
      tenantId: tenant,
      where: { page_id: { eq: id } },
      limit: 1
    });
    if (result.total === 0) {
      console.error(`GET [/content/:type/:id] Content not found: type=${type}, id=${id}, tenant=${tenant}`);
      return fail(res, 404, 'Content not found');
    }
    return ok(res, result.items[0]);
  } catch (e: any) {
    console.error('GET [/content/:type/:id] Content get error:', e);
    return fail(res, 500, 'Internal error', 'CONTENT_GET_ERR');
  }
});

contentApiRouter.get('/content/:type', async (req: express.Request, res: express.Response) => {
  try {
    const { type } = req.params;
    const tenant = req.auth?.user?.tenant || (req.query.tenant as string) || 'any';

    debug(`GET [/content/:type] request:`, { type, tenant, query: req.query });

    // TODO: Add content listing authorization
    // - Verify user has read access to content type in this tenant
    // - Apply tenant-based filtering to ensure user only sees authorized content
    // - Consider implementing field-level security for sensitive data
    
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 25;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const pageId = req.query.page_id as string | undefined;
    const rawWhere = req.query.where as string | undefined;
    if (!type) return fail(res, 400, 'Missing type');
    const prism = await Prism.getInstance();
    let where: any = {};
    if (rawWhere) {
      const parsed = parseWhere(rawWhere, res);
      if (parsed === Symbol.for('error')) return; // response already sent
      where = parsed || {};
    }
    if (pageId) {
      // merge or override page_id filter
      where.page_id = where.page_id || { eq: pageId };
    }
    let result;
    try {
      result = await prism.query({ contentType: type, tenantId: tenant, where, limit, offset });
    } catch (e: any) {
      if (e.message && e.message.includes('no definition found')) {
        console.error(`GET [/content/:type] Definition not found for type=${type}, tenant=${tenant}`);
        return fail(res, 400, 'No definition found for content type', 'NO_DEFINITION');
      }
      throw e;
    }
    if (!result) {
      console.error(`GET [/content/:type] Content query failed: type=${type}, tenant=${tenant}`);
      return fail(res, 500, 'Content query failed', 'CONTENT_QUERY_FAIL');
    }
    debug(`GET [/content/:type] fetched ${result.total} items (returned ${result.items?.length || 0})`);
    return ok(res, result.items, { total: result.total, hasMore: result.hasMore });
  } catch (e: any) {
    console.error('GET [/content/:type] Content query error:', e);
    return fail(res, 500, 'Internal error', 'CONTENT_QUERY_ERR');
  }
});

// Simple OpenAPI spec route is now served separately (wired in server) but keeping placeholder here if needed

contentApiRouter.post('/content/:type', async (req: express.Request, res: express.Response) => {
  debug('POST /content/:type hit', { params: req.params, query: req.query, bodyKeys: Object.keys(req.body || {}) });
  try {
    const { type } = req.params;
    const tenant = req.auth?.user?.tenant || (req.query.tenant as string) || 'any';

    debug(`POST [/content/:type] request:`, { type, tenant, body: req.body });

    // TODO: Add content creation authorization
    // - Verify user has write/create permissions for this content type
    // - Check if user can create content in the target tenant
    // - Validate content against user's role-based field restrictions
    // - Auto-populate created_by, tenant_id from authenticated user context
    
    const content = req.body?.content;
    if (!type || !content) return fail(res, 400, 'Missing type or content');
        
    const prism = await Prism.getInstance();
    debug(`POST [/content/:type] Calling prism.create with type=${type}, tenant=${tenant}`);
    let created;
    try {
      created = await prism.create(type, content, tenant);
      debug(`POST [/content/:type] prism.create succeeded, returned:`, JSON.stringify({ created, total: created?.total }, null, 2));
    } catch (prismError: any) {
      console.error(`POST [/content/:type] prism.create threw exception:`, {
        error: prismError,
        message: prismError.message,
        stack: prismError.stack
      });
      throw prismError; // Re-throw to be caught by outer catch
    }
    
    debug(`POST [/content/:type] prism.create returned:`, JSON.stringify({ created, total: created?.total }, null, 2));
    
    if (!created || created.total === 0) {
      console.error(`POST [/content/:type] Create failed - no items returned`);
      return fail(res, 500, 'Create failed', 'CONTENT_CREATE_FAIL');
    }
    
    debug(`POST [/content/:type] Successfully created item:`, JSON.stringify(created.items[0], null, 2));
    return ok(res, created.items[0]);
  } catch (e: any) {
    const { type } = req.params;
    const tenant = req.auth?.user?.tenant || (req.query.tenant as string) || 'any';
    console.error(`POST [/content/:type] Content create error:`, {
      error: e,
      message: e.message,
      stack: e.stack,
      type,
      tenant,
      content: req.body?.content
    });
    return fail(res, 500, `Internal error: ${e.message}`, 'CONTENT_CREATE_ERR');
  }
});

contentApiRouter.put('/content/:type/:id', async (req: express.Request, res: express.Response) => {
  try {
    const { type, id } = req.params;
    const tenant = req.auth?.user?.tenant || (req.query.tenant as string) || 'any';

    debug('PUT [/content/:type/:id] request:', { type, id, tenant, body: req.body });

    // PUT now performs true replacement (full content replacement)
    // This allows users to remove fields from content (e.g., deleting metadata properties)
    // Use PATCH for partial updates (merge semantics)
    
    // TODO: Add content update authorization
    // - Verify user has write/update permissions for this content type
    // - Check if user owns the content or has admin role
    // - Validate that content belongs to user's accessible tenants
    // - Apply field-level security for restricted updates
    // - Auto-populate updated_by, updated_at from authenticated user context
    
    const content = req.body?.content;
    if (!type || !id || !content) {
      console.error('PUT [/content/:type/:id] Missing type, id or content');
      return fail(res, 400, 'Missing type, id or content');
    }
    const prism = await Prism.getInstance();
    const existing = await prism.query({ contentType: type, tenantId: tenant, where: { page_id: { eq: id } }, limit: 1 });
    if (existing.total === 0) {
      console.error(`PUT [/content/:type/:id] Content not found: type=${type}, id=${id}, tenant=${tenant}`);
      return fail(res, 404, 'Content not found');
    }
    const updated = await prism.replace(type, id, content, tenant);
    if (!updated || updated.total === 0) return fail(res, 500, 'Replace failed', 'CONTENT_REPLACE_FAIL');
    return ok(res, updated.items[0]);
  } catch (e: any) {
    console.error(`PUT [/content/:type/:id] Content replace error:`, e);
    return fail(res, 500, 'Internal error', 'CONTENT_REPLACE_ERR');
  }
});

contentApiRouter.patch('/content/:type/:id', async (req: express.Request, res: express.Response) => {
  try {
    const { type, id } = req.params;
    const tenant = req.auth?.user?.tenant || (req.query.tenant as string) || 'any';

    debug('PATCH [/content/:type/:id] request:', { type, id, tenant, body: req.body });

    // TODO: Add content update authorization
    // - Verify user has write/update permissions for this content type
    // - Check if user owns the content or has admin role
    // - Validate that content belongs to user's accessible tenants
    // - Apply field-level security for restricted updates
    // - Auto-populate updated_by, updated_at from authenticated user context
    
    const content = req.body?.content;
    if (!type || !id || !content) {
      console.error('PATCH [/content/:type/:id] Missing type, id or content');
      return fail(res, 400, 'Missing type, id or content');
    }
    
    // PATCH performs partial update - merge with existing content
    // This uses the atomic JSONB merge optimization when ENABLE_PARTIAL_UPDATES=true
    const prism = await Prism.getInstance();
    const existing = await prism.query({ contentType: type, tenantId: tenant, where: { page_id: { eq: id } }, limit: 1 });
    if (existing.total === 0) {
      console.error(`PATCH [/content/:type/:id] Content not found: type=${type}, id=${id}, tenant=${tenant}`);
      return fail(res, 404, 'Content not found');
    }
    
    const updated = await prism.update(type, id, content, tenant);
    if (!updated || updated.total === 0) return fail(res, 500, 'Update failed', 'CONTENT_UPDATE_FAIL');
    return ok(res, updated.items[0]);
  } catch (e: any) {
    console.error(`PATCH [/content/:type/:id] Content update error:`, e);
    return fail(res, 500, 'Internal error', 'CONTENT_UPDATE_ERR');
  }
});

contentApiRouter.delete('/content/:type/:id', async (req: express.Request, res: express.Response) => {
  try {
    const { type, id } = req.params;
    const tenant = req.auth?.user?.tenant || (req.query.tenant as string) || 'any';

    debug('DELETE [/content/:type/:id] request:', { type, id, tenant });

    // TODO: Add content deletion authorization
    // - Verify user has delete permissions for this content type
    // - Check if user owns the content or has admin role
    // - Validate that content belongs to user's accessible tenants
    // - Consider soft-delete vs hard-delete based on user permissions
    // - Log deletion action with user context for audit trail
    
    if (!type || !id) return fail(res, 400, 'Missing type or id');
    const prism = await Prism.getInstance();
    // Ensure type should be an alphabetic string, id should be alphanumeric or UUID format
    const sanitizedType = type.replace(/[^a-zA-Z0-9_-]/g, '');
    const sanitizedId = id.replace(/[^a-zA-Z0-9_-]/g, '');
    if (sanitizedType !== type || sanitizedId !== id) {
      console.error(`Cannot delete [/content/:type/:id] Invalid type or id format: type=${type}, id=${id}`);
      return fail(res, 400, 'Invalid type or id format', 'BAD_TYPE_ID');
    }
    const existing = await prism.query({ contentType: sanitizedType, tenantId: tenant, where: { page_id: { eq: sanitizedId } }, limit: 1 });
    if (existing.total === 0) {
      console.error(`Cannot delete [/content/:type/:id] Content not found: type=${sanitizedType}, id=${sanitizedId}, tenant=${tenant}`);
      return fail(res, 404, 'Content not found');
    }
    const deleted = await prism.delete(type, id, tenant);
    if (!deleted) return fail(res, 500, 'Delete failed', 'CONTENT_DELETE_FAIL');
    return ok(res, { deleted: true });
  } catch (e: any) {
    console.error(`Cannot delete [/content/:type/:id] Content delete error:`, e);
    return fail(res, 500, 'Internal error', 'CONTENT_DELETE_ERR');
  }
});

export default contentApiRouter;
