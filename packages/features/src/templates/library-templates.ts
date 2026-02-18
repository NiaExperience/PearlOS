
import { checkersChallengeTemplate } from './checkers.template';
import { chessPersistentTemplate } from './chess.template';
import { counterWidgetTemplate } from './counter-widget.template';
import { partyPackEmojiVoteTemplate } from './party-pack-emoji-vote.template';
import { partyPackScoreKeeperTemplate } from './party-pack-score-keeper.template';
import { quickPollTemplate } from './quick-poll.template';
import { spaceInvadersLiteTemplate } from './space-invaders-lite.template';
import { spaceWarTemplate } from './space-war.template';
export interface LibraryAppendix {
  title: string;
  body: string;
  referenceOnly?: boolean;
  note?: string;
}

/**
 * Valid library types that map to content_type in bot tools.
 * These are the only allowed values for libraryType.
 */
export type LibraryType = 'game' | 'app' | 'tool' | 'interactive';

export interface LibraryTemplateDescriptor {
  id: string;
  libraryType: LibraryType;
  name: string;
  filename: string;
  description: string;
  tags?: string[];
  content: string;
}

const LIBRARY_TEMPLATES: Record<LibraryType, LibraryTemplateDescriptor[]> = {
  app: [],
  interactive: [
    quickPollTemplate,
    partyPackScoreKeeperTemplate,
    partyPackEmojiVoteTemplate,
  ],
  tool: [
    counterWidgetTemplate,
  ],
  game: [
    spaceWarTemplate,
    spaceInvadersLiteTemplate,
    chessPersistentTemplate,
    checkersChallengeTemplate,
  ]
};

const normalizeLibraryType = (libraryType?: string): LibraryType | undefined => {
  const normalized = libraryType?.trim().toLowerCase();
  if (normalized === 'game' || normalized === 'app' || normalized === 'tool' || normalized === 'interactive') {
    return normalized;
  }
  return undefined;
};

const getAllTemplates = (): LibraryTemplateDescriptor[] =>
  (Object.keys(LIBRARY_TEMPLATES) as LibraryType[]).flatMap(key => LIBRARY_TEMPLATES[key]);

export function getLibraryTemplates(libraryType?: string): LibraryTemplateDescriptor[] {
  const normalized = normalizeLibraryType(libraryType);
  if (normalized) {
    return LIBRARY_TEMPLATES[normalized] || [];
  }

  if (!libraryType) return [];

  // Fallback: allow callers to pass a template id or tag to retrieve specific templates
  const query = libraryType.trim().toLowerCase();
  const all = getAllTemplates();
  const matches = all.filter(t =>
    t.id.toLowerCase() === query ||
    t.id.toLowerCase().startsWith(query) ||
    t.tags?.some(tag => tag.toLowerCase() === query)
  );
  return matches;
}

export function resolveLibraryTemplate(
  libraryType?: string,
  templateId?: string
): {
  normalizedType?: LibraryType;
  templates: LibraryTemplateDescriptor[];
  selected?: LibraryTemplateDescriptor;
  needsChoice: boolean;
} {
  const normalizedType = normalizeLibraryType(libraryType);
  const templates = getLibraryTemplates(libraryType);
  const effectiveType = normalizedType || (templates[0]?.libraryType as LibraryType | undefined);

  if (!effectiveType || templates.length === 0) {
    return { normalizedType: effectiveType, templates: [], needsChoice: false };
  }

  if (templates.length === 1) {
    return { normalizedType: effectiveType, templates, selected: templates[0], needsChoice: false };
  }

  if (templateId) {
    const selected = templates.find(t => t.id === templateId);
    if (selected) {
      return { normalizedType: effectiveType, templates, selected, needsChoice: false };
    }
  }

  return { normalizedType: effectiveType, templates, needsChoice: true };
}

export function buildLibraryAppendix(template: LibraryTemplateDescriptor): LibraryAppendix {
  return {
    title: `${template.name} (${template.filename})`,
    note: 'Use this as the starting structure; enhance visuals, validation, and persistence per main requirements.',
    body: [
      'TEMPLATE STARTER:',
      '```html',
      template.content,
      '```'
    ].join('\n'),
    referenceOnly: false
  };
}

export function summarizeLibraryOptions(templates: LibraryTemplateDescriptor[]) {
  return templates.map(t => ({
    id: t.id,
    name: t.name,
    filename: t.filename,
    description: t.description,
    libraryType: t.libraryType,
    tags: t.tags || []
  }));
}

/**
 * Build a prompt-friendly string of all available library templates
 * for inclusion in bot tool descriptions. This helps the LLM understand
 * which templates are available and when to use them.
 * 
 * @returns A formatted string listing all templates with guidance
 */
export function buildPromptFriendlyTemplateGuidance(): string {
  const allTemplates: LibraryTemplateDescriptor[] = [];
  
  // Collect all templates from all categories
  for (const category of Object.keys(LIBRARY_TEMPLATES) as LibraryType[]) {
    allTemplates.push(...LIBRARY_TEMPLATES[category]);
  }
  
  if (allTemplates.length === 0) {
    return '';
  }
  
  const lines: string[] = [
    '',
    'AVAILABLE LIBRARY TEMPLATES:',
    'When the user\'s request matches one of these templates, include library_type and library_template_id in your tool call.',
    ''
  ];
  
  for (const template of allTemplates) {
    lines.push(`- library_type: "${template.libraryType}", library_template_id: "${template.id}"`);
    lines.push(`  Name: ${template.name}`);
    lines.push(`  Description: ${template.description}`);
    lines.push('');
  }
  
  lines.push('If no template matches the user\'s request, omit library_type and library_template_id to generate from scratch.');
  
  return lines.join('\n');
}

/**
 * Get all available library types (categories).
 */
export function getLibraryTypes(): LibraryType[] {
  return Object.keys(LIBRARY_TEMPLATES) as LibraryType[];
}

/**
 * Get all template IDs across all library types.
 */
export function getAllTemplateIds(): string[] {
  const ids: string[] = [];
  for (const category of Object.keys(LIBRARY_TEMPLATES) as LibraryType[]) {
    ids.push(...LIBRARY_TEMPLATES[category].map(t => t.id));
  }
  return ids;
}
