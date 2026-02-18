/* eslint-disable @typescript-eslint/no-explicit-any */
'use server';

import { Prism, PrismContentResult } from '@nia/prism';
import { ContentActions } from '@nia/prism/core/actions';
import { getAssistantBySubDomain } from '@nia/prism/core/actions/assistant-actions';
import { getUserOrganizationRoles } from '@nia/prism/core/actions/organization-actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { IOrganization } from '@nia/prism/core/blocks/organization.block';
import { isValidUUID } from '@nia/prism/core/utils';

import { SUPERADMIN_USER_ID } from '@interface/constants/superadmin';
import { HtmlGenerationDefinition } from '../definition';
import {
  CreateHtmlGenerationRequest,
  HtmlContent,
  ListHtmlGenerationsFilter
} from '../types/html-generation-types';
import { deleteAppletStorage, findAppletStorage } from '@interface/features/HtmlGeneration/actions/applet-storage-actions';
import { findNoteWithFuzzySearch } from '@interface/features/Notes/lib/notes-api';
import { interfaceAuthOptions } from '@interface/lib/auth-config';

import { buildStorageLibraryAppendix } from '@nia/features';

import { generateOpId, getDiagnostics as getDiagEntries, recordError as recordDiagError, recordStart as recordDiagStart, recordSuccess as recordDiagSuccess } from '../lib/diagnostics';
import { generateGenericName, analyzeNamingIntent } from '../lib/naming-system';
import { generateWithAnthropic, generateWithGemini, generateWithOpenAI, stripCodeFences } from '../lib/providers';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[html-generation.actions]');

// Update HtmlContent Input Type
export type UpdateHtmlContentParams = Partial<HtmlContent>;

/**
 * Creates the HTML generation definition schema in the Prism system for a specific tenant.
 * This establishes the data structure and validation rules for HTML content objects.
 * 
 * @param tenantId - The tenant identifier to scope the definition
 * @returns Promise resolving to the created HTML generation definition
 * @throws Error if definition creation fails or returns empty result
 * 
 * @example
 * ```typescript
 * const definition = await createHtmlGenerationDefinition('tenant123');
 * ```
 */
export async function createHtmlGenerationDefinition(tenantId: string) {
  const prism = await Prism.getInstance();
  const created = await prism.createDefinition(HtmlGenerationDefinition, tenantId);

  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create HtmlGeneration definition');
  }

  return created.items[0];
}

/**
 * Ensures that the HtmlGeneration definition exists before executing an operation.
 * If the definition is missing, it will be created and the operation retried.
 */
export async function ensureHtmlGenerationDefinition<T>(operation: () => Promise<T>, tenantId: string): Promise<T> {
  let result: T;
  try {
    result = await operation();
  } catch (error) {
    const msg = `Content definition for type "${HtmlGenerationDefinition.dataModel.block}" not found.`;
    if (error instanceof Error && error.message.includes(msg)) {
      await createHtmlGenerationDefinition(tenantId);
      log.warn('Retrying operation after creating HtmlGeneration definition', { tenantId });
      result = await operation();
    } else {
      log.error('Error in ensureHtmlGenerationDefinition', { err: error });
      throw error;
    }
  }
  return result;
}

/**
 * Creates a new HtmlGeneration record for the authenticated user.
 */
export async function createHtmlContent(contentData: HtmlContent, tenantId: string): Promise<HtmlContent> {
  const prism = await Prism.getInstance();
  const session = await getSessionSafely(undefined, interfaceAuthOptions);

  if (!session || !session.user || !session.user.id) {
    throw new Error('Unauthorized');
  }

  if (!tenantId || !isValidUUID(tenantId)) {
    throw new Error('Invalid tenant ID');
  }

  const now = new Date().toISOString();
  const payload: HtmlContent & { createdBy: string; createdAt: string; updatedAt: string } = {
    ...contentData,
    createdBy: contentData.createdBy || session.user.id,
    tenantId,
    createdAt: contentData.createdAt || now,
    updatedAt: contentData.updatedAt || now
  } as HtmlContent & { createdBy: string; createdAt: string; updatedAt: string };

  const func = async () => prism.create(HtmlGenerationDefinition.dataModel.block, payload, tenantId);
  const created = await ensureHtmlGenerationDefinition(func, tenantId) as PrismContentResult;

  if (!created || created.total === 0 || !created.items.length) {
    throw new Error('Failed to create HtmlGeneration content');
  }

  return created.items[0] as HtmlContent;
}

/**
 * Fetches a single HtmlGeneration record by id for the given tenant.
 */
export async function findHtmlContentById(contentId: string, tenantId: string): Promise<HtmlContent | null> {
  if (!tenantId) {
    throw new Error('tenantId is required');
  }
  if (!contentId) {
    throw new Error('contentId is required');
  }

  const prism = await Prism.getInstance();
  const query = {
    contentType: HtmlGenerationDefinition.dataModel.block,
    tenantId,
    where: { page_id: { eq: contentId } },
    orderBy: { createdAt: 'desc' as const }
  };

  const func = async () => prism.query(query);
  const result = await ensureHtmlGenerationDefinition(func, tenantId) as PrismContentResult;

  if (!result.items || result.items.length === 0) {
    return null;
  }

  return result.items[0] as HtmlContent;
}

/**
 * Batch-fetch HtmlGeneration records by ids for the given tenant to reduce query volume.
 */
export async function findHtmlContentsByIds(contentIds: string[], tenantId: string): Promise<HtmlContent[]> {
  if (!tenantId) {
    throw new Error('tenantId is required');
  }
  const uniqueIds = Array.from(new Set((contentIds || []).filter(Boolean)));
  if (!uniqueIds.length) return [];

  const prism = await Prism.getInstance();
  const query = {
    contentType: HtmlGenerationDefinition.dataModel.block,
    tenantId,
    where: { page_id: { in: uniqueIds } },
    orderBy: { createdAt: 'desc' as const }
  };

  const func = async () => prism.query(query);
  const result = await ensureHtmlGenerationDefinition(func, tenantId) as PrismContentResult;

  // Some legacy records may only have _id; align on page_id fallback
  return (result.items || []) as HtmlContent[];
}

/**
 * Lists HtmlGeneration records for a user/tenant optionally filtered by content type.
 */
export async function listHtmlContent(
  userId: string,
  tenantId: string,
  contentType?: HtmlContent['contentType'],
  limit: number = 50,
  offset: number = 0
): Promise<HtmlContent[]> {
  if (!userId) {
    throw new Error('userId is required');
  }
  if (!tenantId ) {
    throw new Error('tenantId is required');
  }
  const where: Record<string, unknown> = {
    parent_id: { eq: userId }
  };

  if (contentType) {
    where.indexer = { path: 'contentType', equals: contentType } as any;
  }

  const func = async () =>
    ContentActions.findContent({
      tenantId,
      contentType: HtmlGenerationDefinition.dataModel.block,
      where,
      orderBy: { createdAt: 'desc' as const },
      limit,
      offset
    });

  const result = await ensureHtmlGenerationDefinition(func, tenantId) as PrismContentResult;
  return (result.items || []) as HtmlContent[];
}

/**
 * Updates a HtmlGeneration record owned by the authenticated user.
 */
export async function updateHtmlContent(
  contentId: string,
  updateData: UpdateHtmlContentParams,
  tenantId: string
): Promise<HtmlContent> {
  const session = await getSessionSafely(undefined, interfaceAuthOptions);
  if (!session || !session.user || !session.user.id) {
    throw new Error('Unauthorized');
  }

  const existing = await findHtmlContentById(contentId, tenantId);
  if (!existing) {
    throw new Error('Content not found');
  }

  if (existing.createdBy && existing.createdBy !== session.user.id) {
    throw new Error('Unauthorized to update this content');
  }

  const patch = {
    ...updateData,
    updatedAt: new Date().toISOString()
  } as UpdateHtmlContentParams & { updatedAt: string };

  const func = async () =>
    ContentActions.updateContent(
      HtmlGenerationDefinition.dataModel.block,
      contentId,
      patch,
      tenantId
    );

  const result = await ensureHtmlGenerationDefinition(func, tenantId) as PrismContentResult;

  if (!result || result.total === 0 || !result.items.length) {
    throw new Error('Failed to update HtmlGeneration content');
  }

  return result.items[0] as HtmlContent;
}

/**
 * Deletes an HTML content and all associated AppletStorage records.
 * 
 * @param contentId - The unique identifier of the content to delete
 * @param tenantId - The tenant identifier
 * @returns Promise resolving to boolean indicating success
 * @throws Error if content not found, user unauthorized, or deletion fails
 */
export async function deleteHtmlContent(contentId: string, tenantId: string): Promise<boolean> {
  try {
    const session = await getSessionSafely(undefined, interfaceAuthOptions);
    if (!session || !session.user || !session.user.id) {
      throw new Error('Unauthorized');
    }

    // First, find the existing content to verify ownership
    const existingContent = await findHtmlContentById(contentId, tenantId);
    if (!existingContent) {
      throw new Error('Content not found');
    }

    if (existingContent.createdBy !== session.user.id) {
      throw new Error('Unauthorized to delete this content');
    }

    // Delete all associated AppletStorage records first
    try {
      // Query using Prism's indexer query syntax
      const storageRecords = await findAppletStorage(
        { indexer: { path: 'appletId', equals: contentId } }, 
        tenantId
      );
      
      if (storageRecords && storageRecords.total > 0) {
        log.info('Deleting AppletStorage record(s) for applet', { contentId, count: storageRecords.total });
        
        // Delete all storage records
        const deletePromises = storageRecords.items.map((record: any) => 
          deleteAppletStorage(record._id, tenantId).catch((err: any) => {
            log.error('Failed to delete AppletStorage record', { err, recordId: record._id });
            return false;
          })
        );
        
        await Promise.all(deletePromises);
        log.info('Deleted AppletStorage records for applet', { contentId });
      }
    } catch (error) {
      // Log but don't fail the deletion if AppletStorage cleanup fails
      log.error('Error cleaning up AppletStorage records', { err: error, contentId });
    }

    // Delete the HtmlGeneration record
    const prism = await Prism.getInstance();
    const func = async () => {
      return await prism.delete(HtmlGenerationDefinition.dataModel.block, contentId, tenantId);
    };
    const result = await ensureHtmlGenerationDefinition(func, tenantId);

    return result ?? false;

  } catch (error) {
    log.error('Error deleting HTML content', { err: error, contentId });
    throw error;
  }
}

// =============================================================================
// AI GENERATION FUNCTIONS
// =============================================================================

async function generateHtmlWithAI(
  contentType: string,
  title: string,
  description: string,
  features: string[] = [],
  userRequest: string,
  useOpenAI: boolean = false,
  aiProvider?: 'openai' | 'anthropic' | 'gemini',
  aiModel?: string,
  _tenantId?: string,
  _assistantName?: string,
  includeStorageLibrary: boolean = true
): Promise<string> {
  const opId = generateOpId();
  // Parameters captured in diagnostics if needed; avoid noisy logs in production

  const featuresText = features.length > 0 ? `\nSpecific features requested: ${features.join(', ')}` : '';
  const storageLibraryAppendix = includeStorageLibrary
    ? buildStorageLibraryAppendix({ tenantId: _tenantId, assistantName: _assistantName })
    : '';
  const storageAppendixListing = storageLibraryAppendix
    ? '\n\nAPPENDICES:\n- APPENDIX A - STORAGE LIBRARY: NiaAPI helper plus button/validation rules (reference only; do not include in final HTML)\n'
    : '';
  const storageAppendixBlock = storageLibraryAppendix
    ? `\n\n### APPENDIX A - STORAGE LIBRARY\n${storageLibraryAppendix}`
    : '';


  // Optionally enrich prompts with API schema info in the future.

  const prompt = `Create a complete, self-contained HTML file based on the following requirements.

Description: ${description}${featuresText}
Original user request: "${userRequest}"

CRITICAL REQUIREMENTS:
1. Create a SINGLE HTML file with embedded CSS and JavaScript
2. DO NOT include any title, heading, or heading element (no h1, h2, h3, etc.) in the HTML content
3. Do NOT include any contentType labels or badges in the HTML
4. Start the content directly with the functional elements (game board, app interface, etc.)
5. Make it visually appealing with modern styling (gradients, shadows, animations)
6. Ensure it's fully functional and interactive
7. Use a beautiful color scheme and responsive design
8. Include proper logic, event handling, and user feedback
9. Add emojis and visual polish
10. Make it mobile-friendly
11. All code must be in ONE file - no external dependencies
12. DO NOT use any external resources (no external images, fonts, APIs, or placeholder services)
13. All visual assets must be created with CSS, SVG, or Canvas - no external URLs

DATA PERSISTENCE - APPLET API:
Use the built-in Applet API (see STORAGE LIBRARY APPENDIX below) whenever the experience benefits from persisted state. The appendix includes the NiaAPI helper and button/validation rules; embed the NiaAPI helper snippet (attach it to window.api) near the top of the HTML so storage calls always work, and then use that helper for persistence (only skip if truly no state needs saving).

CRITICAL JAVASCRIPT REQUIREMENTS:
- ALL JavaScript functions MUST be defined in the global scope (window object)
- Use window.functionName = function() { ... } for ALL functions
- EVERY button MUST have a working click handler - no decorative buttons allowed
- EVERY form input MUST have proper event handling and validation
- EVERY interactive element MUST actually perform its intended function
- Use addEventListener('click', ...) or onclick with global functions
- Ensure DOMContentLoaded is used for initialization: document.addEventListener('DOMContentLoaded', function() { ... });
- ALL buttons must have meaningful functionality that matches their text/purpose
- Include proper error handling and structured logging for debugging
- Ensure all functions are accessible and properly bound to DOM elements
- NO PLACEHOLDER or non-functional buttons - everything must work

CRITICAL FORM VALIDATION REQUIREMENTS:
- Always show generic error messages like "Please match the requested format"
- ALWAYS provide specific, helpful format examples for each input field
- For phone numbers: Show format like "Format: (555) 123-4567 or 555-123-4567"
- For dates: Show format like "Format: MM/DD/YYYY or YYYY-MM-DD"
- For emails: Show format like "Format: user@example.com"
- For credit cards: Show format like "Format: 1234 5678 9012 3456"
- For postal codes: Show format like "Format: 12345 or 12345-6789"
- Include placeholder text that demonstrates the expected format
- Use HTML5 input types (tel, email, date, etc.) with appropriate patterns
- Provide real-time validation feedback as users type
- Show format examples in tooltips, help text, or placeholder attributes
- Make error messages specific and actionable
- Use visual indicators (colors, icons) to show validation status

Guidelines:
- For games: Include scoring, game over conditions, restart functionality, controls
- For apps: Include full CRUD operations and use the NiaAPI storage library for persistence; reserve localStorage for tiny, non-critical caches only
- For tools: Include multiple features, export/import if relevant
- For interactive: Include engaging animations, feedback, progress tracking

${storageAppendixListing}

UNIVERSAL BUTTON FUNCTIONALITY REQUIREMENTS:
- If a button says "Start Game" - it must actually start a game
- If a button says "Add Item" - it must actually add an item
- If a button says "Calculate" - it must actually perform calculations
- If a button says "Save" - it must actually save data via the NiaAPI storage library or equivalent persisted state (localStorage only for trivial UI hints)
- If a button says "Reset" - it must actually reset the application
- If a button says "Submit" - it must actually process the form
- Use proper event delegation for dynamically created buttons
- Store application state via the NiaAPI storage library; use localStorage only for lightweight session UI hints
- Provide user feedback for all button actions (visual/text changes)

MANDATORY BUTTON PATTERNS - CHOOSE APPROPRIATE:
Pattern 1 (Direct onclick):
<button onclick="performAction()" id="actionBtn">Action</button>

Pattern 2 (Event listener):
<button id="actionBtn">Action</button>
<script>
document.getElementById('actionBtn').addEventListener('click', performAction);
</script>

Pattern 3 (Event delegation for dynamic buttons):
<script>
document.addEventListener('click', function(e) {
  if (e.target.matches('.dynamic-btn')) {
    performAction(e.target);
  }
});
</script>

FORM VALIDATION EXAMPLES - USE THESE PATTERNS:
For Phone Number Input:
<input type="tel" placeholder="(555) 123-4567" pattern="[0-9 ()-]+" title="Format: (555) 123-4567 or 555-123-4567">
<div class="format-hint">Format: (555) 123-4567 or 555-123-4567</div>

For Date Input:
<input type="date" placeholder="YYYY-MM-DD" title="Format: YYYY-MM-DD">
<div class="format-hint">Format: YYYY-MM-DD</div>

For Email Input:
<input type="email" placeholder="user@example.com" title="Format: user@example.com">
<div class="format-hint">Format: user@example.com</div>

For Credit Card Input:
<input type="text" placeholder="1234 5678 9012 3456" pattern="[0-9\\s]+" maxlength="19" title="Format: 1234 5678 9012 3456">
<div class="format-hint">Format: 1234 5678 9012 3456</div>

For Postal Code Input:
<input type="text" placeholder="12345" pattern="[0-9\\-]+" title="Format: 12345 or 12345-6789">
<div class="format-hint">Format: 12345 or 12345-6789</div>

VALIDATION JAVASCRIPT PATTERN:
function validateInput(input, format) {
  const value = input.value.trim();
  const isValid = /* validation logic */;
  
  if (!isValid) {
    showError(input, 'Please use format: ' + format);
  } else {
    clearError(input);
  }
}

function showError(input, message) {
  const errorDiv = input.parentNode.querySelector('.error-message');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }
  input.style.borderColor = '#dc3545';
}

function clearError(input) {
  const errorDiv = input.parentNode.querySelector('.error-message');
  if (errorDiv) {
    errorDiv.style.display = 'none';
  }
  input.style.borderColor = '#28a745';
}

Return ONLY the HTML code, nothing else. Start with <!DOCTYPE html> and end with </html>.${storageLibraryAppendix ? ' Use APPENDIX A as reference; do not include appendix content in the final HTML.' : ''}${storageAppendixBlock}`;

    // Provider selection precedence: explicit aiProvider → legacy useOpenAI flag
    const provider = aiProvider || (useOpenAI ? 'openai' : 'anthropic');

  // Model-specific token limits to avoid API errors
  const getMaxTokens = (provider: string, model?: string): number => {
    if (provider === 'openai') {
      if (model === 'gpt-5' || model === 'gpt-5-mini' || model === 'gpt-5-nano' || model === 'o3') return 12000; // New models support higher limits
      if (model === 'gpt-5-codex' || model === 'gpt5-high') return 16000; // gpt-5-codex and gpt5-high support very high limits
      if (model === 'gpt-4-turbo') return 4096; // gpt-4-turbo has 4096 max output tokens
      if (model === 'gpt-3.5-turbo') return 4096; // gpt-3.5-turbo has 4096 max output tokens
      return 8000; // gpt-4o and gpt-4o-mini support higher limits
    }
    if (provider === 'anthropic') {
      if (model === 'claude-sonnet-4-20250514') return 12000; // New Sonnet 4 supports higher limits
      return 8000; // Other Claude models support 8000+ output tokens
    }
    if (provider === 'gemini') {
      return 8000; // Gemini supports 8000+ output tokens
    }
    return 4096; // Safe default
  };

  const maxTokens = getMaxTokens(provider, aiModel);
  log.info('generateHtmlWithAI configured', { provider, aiModel, maxTokens, opId });

  let raw: string;
  try {
    log.info('generateHtmlWithAI calling provider', { provider, aiModel, opId });
    if (provider === 'openai') {
      log.info('generateHtmlWithAI calling OpenAI', { aiModel, opId });
      try {
        raw = await generateWithOpenAI(prompt, { model: aiModel, maxTokens, opId });
        log.info('generateHtmlWithAI OpenAI call completed', { aiModel, opId });
      } catch (openaiError: any) {
        log.error('generateHtmlWithAI OpenAI call failed; evaluating fallback', { err: openaiError, aiModel, opId });
        
        // Check if this is a model error that should trigger fallback to gpt5-high
        const errorMessage = openaiError?.message || '';
        const isModelError = errorMessage.includes('model') || 
                            errorMessage.includes('not found') || 
                            errorMessage.includes('invalid') ||
                            errorMessage.includes('does not exist') ||
                            aiModel === 'gpt-5-codex'; // Always try fallback for gpt-5-codex failures
        
        if (isModelError && aiModel === 'gpt-5-codex') {
          log.warn('OpenAI gpt-5-codex failed; falling back to gpt-5 with reasoning.effort=high', { aiModel, opId });
          const fallbackModel = 'gpt-5';
          const fallbackReasoningEffort = 'high' as const;
          const fallbackMaxTokens = getMaxTokens('openai', fallbackModel);
          log.info('generateHtmlWithAI OpenAI fallback request', { fallbackModel, fallbackReasoningEffort, fallbackMaxTokens, opId });
          
          try {
            raw = await generateWithOpenAI(prompt, { model: fallbackModel, maxTokens: fallbackMaxTokens, opId, reasoningEffort: fallbackReasoningEffort });
            log.info('generateHtmlWithAI OpenAI fallback succeeded', { fallbackModel, opId });
          } catch (fallbackError) {
            log.error('generateHtmlWithAI OpenAI fallback failed', { err: fallbackError, fallbackModel, opId });
            throw fallbackError;
          }
        } else {
          // Not a model error or different model, re-throw the original error
          throw openaiError;
        }
      }
    } else if (provider === 'gemini') {
      log.info('generateHtmlWithAI calling Gemini', { aiModel, opId });
      raw = await generateWithGemini(prompt, { model: aiModel, maxTokens, opId });
      log.info('generateHtmlWithAI Gemini call completed', { aiModel, opId });
    } else {
      log.info('generateHtmlWithAI calling Anthropic', { aiModel, opId });
      try {
        raw = await generateWithAnthropic(prompt, { model: aiModel, maxTokens, opId });
        log.info('generateHtmlWithAI Anthropic call completed', { aiModel, opId });
      } catch (anthropicError: any) {
        log.error('generateHtmlWithAI Anthropic call failed; evaluating fallback', { err: anthropicError, aiModel, opId });
        
        // Check if this is a credit/billing error that should trigger fallback
        const errorMessage = anthropicError?.message || '';
        const isCreditError = errorMessage.includes('credit balance') || 
                             errorMessage.includes('billing') || 
                             errorMessage.includes('payment') ||
                             errorMessage.includes('too low to access');
        
        if (isCreditError) {
          log.warn('Anthropic credit error detected; falling back to OpenAI GPT-4o', { aiModel, opId });
          const fallbackModel = 'gpt-4o'; // Use GPT-4o as fallback
          const fallbackMaxTokens = getMaxTokens('openai', fallbackModel);
          log.info('generateHtmlWithAI OpenAI fallback request from Anthropic', { fallbackModel, fallbackMaxTokens, opId });
          
          try {
            raw = await generateWithOpenAI(prompt, { model: fallbackModel, maxTokens: fallbackMaxTokens, opId });
            log.info('generateHtmlWithAI OpenAI fallback completed', { fallbackModel, opId });
          } catch (fallbackError) {
            log.error('generateHtmlWithAI OpenAI fallback failed', { err: fallbackError, fallbackModel, opId });
            throw fallbackError; // throw fallback error
          }
        } else {
          // Not a credit error, re-throw the original error
          throw anthropicError;
        }
      }
    }

    log.info('generateHtmlWithAI successful', { provider, aiModel, opId });
    log.debug('generateHtmlWithAI raw length', { rawLength: raw.length, opId });

    const cleaned = stripCodeFences(raw);
    recordDiagSuccess(opId, { responseLength: cleaned.length });
    log.debug('generateHtmlWithAI cleaned length', { cleanedLength: cleaned.length, opId });

    log.info('generateHtmlWithAI returning cleaned response', { opId });
    return cleaned;
  } catch (error) {
    log.error('generateHtmlWithAI failed', { err: error, provider, aiModel, opId });
    log.error('generateHtmlWithAI stack trace', { stack: error instanceof Error ? error.stack : 'No stack trace', opId });
    recordDiagError(opId, { provider: provider as any, model: aiModel, error });
    throw error; // Re-throw to trigger fallback in caller
  }
}

function createFallbackHtml(title: string, description: string, aiError?: any): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 600px;
        }

    .btn {
      display: inline-block;
      margin-top: 16px;
      background: #667eea;
      color: white;
      border-radius: 10px;
      border: none;
      padding: 12px 24px;
      transition: all 0.3s ease;
      box-shadow: 0 4px 15px rgba(102,126,234,0.4);
      cursor: pointer;
    }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102,126,234,0.6);
        }
        .note {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            margin-top: 20px;
            color: #666;
            border-left: 4px solid #667eea;
            text-align: left;
        }
        .error-message {
            color: #a0a4ab;
            font-style: italic;
            display: inline;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="description">${description}</div>
        <button class="btn" onclick="alert('This is a placeholder. AI generation would create full functionality here!')">
            Get Started
        </button>
        <div class="note">
            <strong>Note:</strong> This is a fallback template. With AI integration, 
            a complete, functional app would be generated based on your specific requirements.
        </div>
        ${aiError ? `<div class="note"><span class="error-message">${new String(aiError)}</span></div>` : ''}
    </div>
</body>
</html>`;
}

// =============================================================================
// API WRAPPER FUNCTIONS (for route handlers)
// =============================================================================

export async function createHtmlGeneration(request: CreateHtmlGenerationRequest): Promise<HtmlContent> {
  try {
    const finalProvider = request.aiProvider || 'openai'; // Default to OpenAI for HTML generation
    // Set default model specifically for HTML generation - use gpt-5 as primary for openai
    const finalModel = request.aiModel || (finalProvider === 'openai' ? 'gpt-5' : (finalProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'default'));

    // Get session/tenant context
    // Get tenant ID and assistant information from session  
    const session = await getSessionSafely(undefined, interfaceAuthOptions);
    if (!session) {
      throw new Error('Unauthorized');
    }

    // Extract assistant name if provided in request
    const assistantName = (request as any).assistantName!;
    const assistant = await getAssistantBySubDomain(assistantName);
    if (!assistant) {
      throw new Error(`Assistant "${assistantName}" not found`);
    }
    const tenantId = assistant.tenantId;

    // If the description is blank but the sourceNoteId is provided, fetch the note content here to use as description.
    if (!request.description && request.sourceNoteId) {
      const noteContent = await findNoteWithFuzzySearch({ id: request.sourceNoteId }, assistantName);
      if (noteContent.found && noteContent.note && noteContent.note.content) {
        log.info('Using content from note as description', { noteId: noteContent.note._id, title: noteContent.note.title });
        request.description = noteContent.note.content;
        
        if (!request.title || request.title.trim() === '') {
          request.title = noteContent.note.title;
        }
      }
    }

    // Generate AI-suggested name if no title provided
    if (!request.title || request.title.trim() === '') {
      const namingResult = analyzeNamingIntent(
        request.userRequest,
        request.contentType,
        request.description,
        undefined
      );
      request.title = namingResult.suggestedName;
      log.info('Generated AI name for applet', { title: request.title, contentType: request.contentType });
    }

    let htmlContent: string;
    let usedFallback = false;
    const opId = generateOpId();
    recordDiagStart(opId, { provider: (request.aiProvider || (request.useOpenAI ? 'openai' : 'anthropic')) as any, model: request.aiModel, promptLength: (request.userRequest || '').length });
    const includeStorageLibrary = request.includeStorageLibrary ?? true;

    // Generate HTML content with AI (fallback to template if provider fails or times out)
    try {
  // Guard: enforce an upper bound on generation time to avoid upstream 504s
  // Bumped to 5 minutes to support complex app creation. Can be overridden via env.
  const timeoutMs = Number(process.env.HTML_GEN_TIMEOUT_MS || 600_000);
      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('GENERATION_TIMEOUT')), timeoutMs);
      });

      htmlContent = await Promise.race([
        generateHtmlWithAI(
          request.contentType,
          request.title!, // title is guaranteed to be set by now
          request.description,
          request.features || [],
          request.userRequest,
          request.useOpenAI || false,
          finalProvider,
          finalModel,
          tenantId,
          assistantName,
          includeStorageLibrary
        ),
        timeoutPromise
      ]);
    } catch (aiError) {
      log.error('createHtmlGeneration: AI generation failed, using fallback template', { err: aiError });
      log.error('createHtmlGeneration stack trace', { stack: aiError instanceof Error ? aiError.stack : 'No stack trace' });
      log.error('createHtmlGeneration fallback triggered', { request });
      // Ensure title is set even in error case
      if (!request.title || request.title.trim() === '') {
        const fallbackName = generateGenericName(request.userRequest || request.description, request.contentType);
        request.title = fallbackName;
        log.info('Generated fallback AI name', { title: request.title });
      }
      htmlContent = createFallbackHtml(request.title, request.description, aiError);
      usedFallback = true;
    }
    // Create the content record
    const contentData: HtmlContent = {
      title: request.title!,
      contentType: request.contentType,
      htmlContent,
      userRequest: request.userRequest,
      isAiGenerated: !usedFallback,
      tenantId: tenantId, 
      tags: request.features || [],
      // Include sourceNoteId if provided
      ...(request.sourceNoteId ? { sourceNoteId: request.sourceNoteId } : {}),
      metadata: {
        aiProvider: finalProvider,
        aiModel: finalModel,
        usedFallback,
        generatedAt: new Date().toISOString(),
        hasApiIntegration: includeStorageLibrary,
        storageLibraryIncluded: includeStorageLibrary,
        tenantId,
        assistantName,
        opId,
        // Include source note metadata if provided
        ...(request.metadata || {}),
        // Persist diagnostics inline with the applet so no external API/CLI is needed
        diagnostics: getDiagEntries(opId, 50)
      }
    };
    const result = await createHtmlContent(contentData, tenantId);
    return result;
  } catch (error) {
    log.error('createHtmlGeneration: error creating HTML generation', { err: error });
    log.error('createHtmlGeneration stack trace', { stack: error instanceof Error ? error.stack : 'No stack trace' });
    throw error;
  }
}

/**
 * Get an HTML generation by ID.
 * @param id - The applet ID to fetch
 * @param assistantName - Optional assistant name to resolve tenantId. If not provided,
 *                        the function will search across all tenants the user has access to.
 */
export async function getHtmlGeneration(id: string, assistantName?: string): Promise<HtmlContent | null> {
  try {
    const session = await getSessionSafely(undefined, interfaceAuthOptions);
    if (!session) {
      throw new Error('Unauthorized');
    }
    const userId = session.user!.id;

    // If assistantName is provided, use it to get the correct tenantId
    if (assistantName) {
      let assistant = await getAssistantBySubDomain(assistantName);
      if (!assistant) {
        assistant = await getAssistantBySubDomain(assistantName);
      }
      if (assistant?.tenantId) {
        const content = await findHtmlContentById(id, assistant.tenantId);
        if (content) return content;
      }
    }

    // Fallback: Search across all tenants the user has access to via shared resources
    // Get all organizations user is a member of
    const roles = await getUserOrganizationRoles(userId, 'any');
    
    if (roles && roles.length > 0) {
      const prism = await Prism.getInstance();
      
      for (const role of roles) {
        // Find the organization to check shared resources
        // We query directly to avoid tenantId restrictions in getOrganizationById
        const orgQuery = {
          contentType: 'Organization',
          tenantId: 'any',
          where: { page_id: role.organizationId }
        };
        const orgResult = await prism.query(orgQuery);
        
        if (orgResult.items.length > 0) {
          const org = orgResult.items[0] as IOrganization;
          
          // Check if this organization shares the requested resource
          if (org.sharedResources && org.sharedResources[id]) {
            // Found access! The resource should be in the organization's tenant
            const sharedContent = await findHtmlContentById(id, org.tenantId);
            if (sharedContent) return sharedContent;
          }
        }
      }
    }

    return null;
  } catch (error) {
    log.error('Error getting HTML generation', { err: error });
    throw error;
  }
}

export async function listHtmlGenerations(filter: ListHtmlGenerationsFilter): Promise<HtmlContent[]> {
  try {
    const session = await getSessionSafely(undefined, interfaceAuthOptions);
    if (!session) {
      throw new Error('Unauthorized');
    }
    const effectiveUserId = (session.user?.id === SUPERADMIN_USER_ID && filter.userId) ? filter.userId : session.user!.id;
    return await listHtmlContent(
      effectiveUserId,
      filter.tenantId,
      filter.contentType,
      filter.limit || 10,
      filter.offset || 0
    );
  } catch (error) {
    log.error('Error listing HTML generations', { err: error });
    throw error;
  }
}

/**
 * Find HtmlGeneration content by jobId (stored in metadata.jobId or metadata.callId)
 */
export async function findHtmlContentByJobId(jobId: string, tenantId: string): Promise<HtmlContent | null> {
  if (!jobId || !tenantId) return null;

  const prism = await Prism.getInstance();
  const query = {
    contentType: HtmlGenerationDefinition.dataModel.block,
    tenantId,
    where: {
      or: [
        { content: { path: 'metadata.jobId', equals: jobId } },
        { content: { path: 'metadata.callId', equals: jobId } },
        { page_id: { eq: jobId } }
      ]
    },
    orderBy: { createdAt: 'desc' as const }
  } as any;

  const func = async () => prism.query(query);
  const result = await ensureHtmlGenerationDefinition(func, tenantId) as PrismContentResult;

  if (!result.items || result.items.length === 0) {
    return null;
  }

  return result.items[0] as HtmlContent;
}
