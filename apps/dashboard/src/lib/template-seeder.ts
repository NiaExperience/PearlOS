import path from 'path';

import { 
  getLibraryTemplates, 
  buildStorageBootstrapSnippet,
  HtmlGenerationDefinition,
  AppletStorageDefinition
} from '@nia/features';
import { Prism } from '@nia/prism';
import {
  assignUserToOrganization,
  createOrganization,
  updateOrganization
} from '@nia/prism/core/actions/organization-actions';
import { ResourceType } from '@nia/prism/core/blocks/resourceShareToken.block';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import dotenv from 'dotenv';

// Load environment variables so Mesh endpoint/secret are available
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '..', '.env.local') });

const TARGET_TENANT_ID = process.env.HTML_SEED_TENANT_ID || '7bd902a4-9534-4fc4-b745-f23368590946';
const SUPERADMIN_USER_ID = '00000000-0000-0000-0000-000000000000';
const ASSISTANT_NAME = 'pearlos';

const TEMPLATE_ID_MAP: Record<string, string> = {
  quick_poll_v1: '233ac08d-ad8d-452a-937d-2c45e54ca755',
  party_pack_poll: '38adba53-42fe-41b6-b198-17a0002f747b',
  party_pack_score: 'd0526071-7b0c-4357-9369-ed7dee0cf73a',
  space_invaders_lite: 'b6a70cb5-2183-4cbd-933f-ab6ca0d1721b',
  space_war: 'e0d55754-e4f6-4fa9-ad7c-db7eebf8743c',
  chess_persistent: '947c36e2-b2cc-44ef-82f1-b1171ee89e9b',
  checkers_challenge: 'e1423f59-4370-4f84-b317-7b447d8a40d9',
  counter_widget_v1: '0ed04c92-3111-462c-a0b8-5842b93ce9b3'
};

const CONTENT_TYPE_MAP: Record<string, 'game' | 'interactive' | 'tool'> = {
  quick_poll_v1: 'interactive',
  party_pack_poll: 'interactive',
  party_pack_score: 'interactive',
  space_invaders_lite: 'game',
  space_war: 'game',
  chess_persistent: 'game',
  checkers_challenge: 'game',
  counter_widget_v1: 'tool'
};

export type UpsertResult = { id: string; created: boolean; title: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureDefinition(definition: any, tenantId: string) {
  const prism = await Prism.getInstance();
  const existing = await prism.findDefinition(definition.dataModel.block, tenantId);
  if (existing.total > 0) return;
  await prism.createDefinition(definition, tenantId);
}

function injectStorageBootstrap(html: string): string {
  const defaultBootstrap = buildStorageBootstrapSnippet();
  const tenantBootstrap = buildStorageBootstrapSnippet({
    tenantId: TARGET_TENANT_ID,
    assistantName: ASSISTANT_NAME
  });
  return html.replace(defaultBootstrap, tenantBootstrap);
}

function ensureHtmlDocument(html: string): string {
  const trimmed = html.trim();
  const hasDoctype = /^<!doctype html>/i.test(trimmed);
  const hasHtmlTag = /<html[\s>]/i.test(trimmed);
  const hasHtmlClose = /<\/html>/i.test(trimmed);

  if (hasDoctype && hasHtmlTag && hasHtmlClose) {
    return html;
  }

  // Wrap existing snippet into a minimal HTML document shell to satisfy HtmlGeneration guidelines.
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '</head>',
    '<body>',
    trimmed,
    '</body>',
    '</html>'
  ].join('\n');
}

async function upsertTemplate(templateId: string, libraryType: string): Promise<UpsertResult> {
  const prism = await Prism.getInstance();
  const templates = getLibraryTemplates(libraryType);
  const template = templates.find(t => t.id === templateId);
  if (!template) {
    throw new Error(`Template ${templateId} not found for library ${libraryType}`);
  }

  const now = new Date().toISOString();
  const contentId = TEMPLATE_ID_MAP[templateId];
  const htmlContent = ensureHtmlDocument(injectStorageBootstrap(template.content));
  const contentType = CONTENT_TYPE_MAP[templateId] || 'interactive';

  const payload = {
    _id: contentId,
    title: template.name,
    contentType,
    htmlContent,
    userRequest: template.description,
    isAiGenerated: false,
    tenantId: TARGET_TENANT_ID,
    tags: template.tags || [],
    metadata: {
      libraryType: template.libraryType,
      templateId,
      filename: template.filename,
      seededBy: 'seed-html-library-templates.ts',
      assistantName: ASSISTANT_NAME,
      storageBootstrapInjected: true
    },
    createdBy: SUPERADMIN_USER_ID,
    createdAt: now,
    updatedAt: now
  };

  const existing = await prism.query({
    contentType: HtmlGenerationDefinition.dataModel.block,
    tenantId: TARGET_TENANT_ID,
    where: { page_id: { eq: contentId } }
  });

  if (existing.total > 0) {
    await prism.update(HtmlGenerationDefinition.dataModel.block, contentId, { ...payload, createdAt: existing.items[0]?.createdAt || now }, TARGET_TENANT_ID);
    return { id: contentId, created: false, title: template.name };
  }

  const created = await prism.create(HtmlGenerationDefinition.dataModel.block, payload, TARGET_TENANT_ID);
  if (!created || created.total === 0) {
    throw new Error(`Failed to create applet ${templateId}`);
  }
  return { id: contentId, created: true, title: template.name };
}

async function ensureSharedToAllReadOnly(resourceId: string, resourceTitle: string) {
  const prism = await Prism.getInstance();

  const targetOrgName = `Share:HtmlGeneration:${resourceId}`;

  // Check if a sharing org exists in the target tenant
  const existingOrg = await prism.query({
    contentType: 'Organization',
    tenantId: 'any',
    where: { "AND": [
      { "parent_id": { "eq": TARGET_TENANT_ID } },
      { "indexer": { "path": "sharedResources", "contains": resourceId } }
    ]}
  }).then(r => (r.total > 0 ? r.items[0] : undefined));

  if (existingOrg) {
    if (!existingOrg.sharedResources || !existingOrg.sharedResources[resourceId]) {
      console.error('  ⚠️ Existing sharing org found but missing resource link; this should not happen. ResourceId=', resourceId, 'Org=', JSON.stringify(existingOrg));
      throw new Error('Existing sharing organization is missing resource link');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = { sharedToAllReadOnly: true };
    if (Object.keys(updates).length > 0) {
      await updateOrganization(existingOrg._id!, TARGET_TENANT_ID, updates);
    }
    await assignUserToOrganization(SUPERADMIN_USER_ID, existingOrg._id!, TARGET_TENANT_ID, OrganizationRole.OWNER);
    return existingOrg._id!;
  }

  console.log('  🆕 Creating sharing org for', resourceTitle, 'in tenant', TARGET_TENANT_ID);
  const org = await createOrganization({
    tenantId: TARGET_TENANT_ID,
    name: targetOrgName,
    description: `Sharing org for HtmlGeneration ${resourceTitle}`,
    sharedToAllReadOnly: true,
    sharedResources: { [resourceId]: ResourceType.HtmlGeneration },
    settings: {
      resourceSharing: true,
      resourceOwnerUserId: SUPERADMIN_USER_ID
    }
  });

  console.log('  👤 Assigning SUPERADMIN owner for org', org._id);
  await assignUserToOrganization(SUPERADMIN_USER_ID, org._id!, TARGET_TENANT_ID, OrganizationRole.OWNER);
  return org._id!;
}

export async function seedHtmlLibraryTemplates(): Promise<{ success: boolean; results: UpsertResult[]; errors: string[] }> {
  const results: UpsertResult[] = [];
  const errors: string[] = [];

  console.log('🌱 Seeding HtmlGeneration templates into tenant', TARGET_TENANT_ID);

  try {
    await ensureDefinition(HtmlGenerationDefinition, TARGET_TENANT_ID);
    await ensureDefinition(AppletStorageDefinition, TARGET_TENANT_ID);
  } catch (err) {
    const msg = `Failed to ensure definitions: ${err instanceof Error ? err.message : String(err)}`;
    console.error('❌', msg);
    errors.push(msg);
    return { success: false, results, errors };
  }

  const targets: Array<{ templateId: string; libraryType: string }> = [
    { templateId: 'counter_widget_v1', libraryType: 'tool' },
    { templateId: 'quick_poll_v1', libraryType: 'interactive' },
    { templateId: 'party_pack_poll', libraryType: 'interactive' },
    { templateId: 'party_pack_score', libraryType: 'interactive' },
    { templateId: 'space_invaders_lite', libraryType: 'game' },
    { templateId: 'space_war', libraryType: 'game' },
    { templateId: 'chess_persistent', libraryType: 'game' },
    { templateId: 'checkers_challenge', libraryType: 'game' }
  ];

  for (const target of targets) {
    try {
      const result = await upsertTemplate(target.templateId, target.libraryType);
      console.log(`${result.created ? 'Created' : 'Updated'} applet`, result.title, '→', result.id);
      results.push(result);

      await ensureSharedToAllReadOnly(result.id, result.title);
    } catch (err) {
      const msg = `Failed to seed ${target.templateId}: ${err instanceof Error ? err.message : String(err)}`;
      console.error('❌', msg);
      errors.push(msg);
    }
  }

  const success = errors.length === 0;
  console.log(success ? '✅ Seed complete' : '⚠️ Seed completed with errors');
  return { success, results, errors };
}
