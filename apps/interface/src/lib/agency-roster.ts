export type AgencyBossId =
  | 'codex'
  | 'claude'
  | 'deepseek-v4-pro'
  | 'glm-5-1'
  | 'kimi-k2-7-code'
  | 'gemini-latest'
  | 'qwen-best';

export type AgencyDepartmentKey = 'code' | 'generic' | 'research' | 'creative' | 'strategy' | 'design';

export type AgencyModelOption = {
  id: string;
  label: string;
  family: string;
  description: string;
  category: string;
};

export type AgencyBossOption = {
  id: AgencyBossId;
  label: string;
  modelId: string;
  sprite: string;
  executor: 'codex' | 'claude';
  specialty: string;
  description: string;
};

export type AgencyRoleConfig = {
  id: string;
  title: string;
  description: string;
  category: string;
  defaultModelId: string;
  options: string[];
};

export type AgencyDepartmentConfig = {
  key: AgencyDepartmentKey;
  title: string;
  description: string;
  roles: AgencyRoleConfig[];
};

export const DEFAULT_AGENCY_BOSS_ID: AgencyBossId = 'codex';

export const AGENCY_BOSS_ROSTER: AgencyBossOption[] = [
  {
    id: 'codex',
    label: 'Codex',
    modelId: 'openai/gpt-5.5',
    sprite: '/agency-assets/agents/Codex.png',
    executor: 'codex',
    specialty: 'Primary code execution',
    description: 'Best default when the Agency needs to edit, test, and ship code.',
  },
  {
    id: 'claude',
    label: 'Claude Opus 4.8',
    modelId: 'anthropic/claude-opus-4.8',
    sprite: '/agency-assets/agents/Opus.png',
    executor: 'claude',
    specialty: 'Fallback judgment and writing',
    description: 'Fallback boss for longform judgment, planning, and careful review.',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek Pro V4',
    modelId: 'deepseek/deepseek-v4-pro',
    sprite: '/agency-assets/agents/DeepSeek.png',
    executor: 'codex',
    specialty: 'Reasoning and long-context planning',
    description: 'Reasoning-heavy OpenRouter boss profile. Code-changing work remains Codex-executed until the OpenRouter executor lands.',
  },
  {
    id: 'glm-5-1',
    label: 'GLM 5.2',
    modelId: 'z-ai/glm-5.2',
    sprite: '/agency-assets/agents/Qwen.png',
    executor: 'codex',
    specialty: 'Long-horizon implementation planning',
    description: 'Strong long-run agent profile for complex decomposition and review.',
  },
  {
    id: 'kimi-k2-7-code',
    label: 'Kimi K2.7 Code',
    modelId: 'moonshotai/kimi-k2.7-code',
    sprite: '/agency-assets/agents/Kimi.png',
    executor: 'codex',
    specialty: 'Visual coding and multimodal build planning',
    description: 'Coding-focused multimodal profile for UI and agentic build planning.',
  },
  {
    id: 'gemini-latest',
    label: 'Gemini 3.5 Flash',
    modelId: 'google/gemini-3.5-flash',
    sprite: '/agency-assets/agents/Gemini.png',
    executor: 'codex',
    specialty: 'Fast multimodal reasoning',
    description: 'Latest high-efficiency Gemini profile in the current OpenRouter roster.',
  },
  {
    id: 'qwen-best',
    label: 'Qwen3.7 Max',
    modelId: 'qwen/qwen3.7-max',
    sprite: '/agency-assets/agents/Qwen.png',
    executor: 'codex',
    specialty: 'Flagship agentic execution',
    description: 'Best current Qwen boss profile for broad agentic work, coding, and long-horizon execution.',
  },
];

export const AGENCY_MODEL_OPTIONS: AgencyModelOption[] = [
  {
    id: 'openai/gpt-5.5',
    label: 'GPT-5.5',
    family: 'OpenAI',
    category: 'coding',
    description: 'Frontier planning and code review.',
  },
  {
    id: 'anthropic/claude-opus-4.8',
    label: 'Claude Opus 4.8',
    family: 'Anthropic',
    category: 'writing',
    description: 'Careful longform judgment, planning, and editorial work.',
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    family: 'DeepSeek',
    category: 'coding',
    description: 'Deep reasoning, long context, and advanced coding.',
  },
  {
    id: 'deepseek/deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    family: 'DeepSeek',
    category: 'commentary',
    description: 'Fast status synthesis and process commentary.',
  },
  {
    id: 'z-ai/glm-5.2',
    label: 'GLM 5.2',
    family: 'Z.ai',
    category: 'coding',
    description: 'Long-horizon coding and autonomous task planning.',
  },
  {
    id: 'moonshotai/kimi-k2.7-code',
    label: 'Kimi K2.7 Code',
    family: 'MoonshotAI',
    category: 'coding',
    description: 'Visual coding, multimodal task decomposition, and UI work.',
  },
  {
    id: 'google/gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    family: 'Google',
    category: 'multimodal',
    description: 'Fast multimodal coding, reasoning, audio, image, video, and file input.',
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro',
    family: 'Google',
    category: 'research',
    description: 'Frontier multimodal reasoning and source-heavy analysis.',
  },
  {
    id: 'qwen/qwen3.7-max',
    label: 'Qwen3.7 Max',
    family: 'Qwen',
    category: 'coding',
    description: 'Flagship Qwen model for agentic execution, coding, and productivity workflows.',
  },
  {
    id: 'qwen/qwen3.7-plus',
    label: 'Qwen3.7 Plus',
    family: 'Qwen',
    category: 'coding',
    description: 'Current Qwen plus profile for coding, analysis, and long-context work.',
  },
  {
    id: 'qwen/qwen3-coder',
    label: 'Qwen3 Coder',
    family: 'Qwen',
    category: 'coding',
    description: 'Reliable default Qwen coding model.',
  },
  {
    id: 'qwen/qwen3-coder-next',
    label: 'Qwen3 Coder Next',
    family: 'Qwen',
    category: 'coding',
    description: 'Fast recovery and local-development coding workflows.',
  },
  {
    id: 'x-ai/grok-4',
    label: 'Grok 4',
    family: 'xAI',
    category: 'adversary',
    description: 'Adversarial review and alternate framing.',
  },
  {
    id: 'google/nano-banana-pro',
    label: 'Nano Banana Pro',
    family: 'Google',
    category: 'image',
    description: 'Image generation and editing specialist.',
  },
  {
    id: 'bytedance/seedance-1-pro',
    label: 'SeeDance Pro',
    family: 'ByteDance',
    category: 'video',
    description: 'Video generation specialist.',
  },
];

const CODE_TOP_10 = [
  'deepseek/deepseek-v4-pro',
  'moonshotai/kimi-k2.7-code',
  'z-ai/glm-5.2',
  'qwen/qwen3.7-max',
  'qwen/qwen3.7-plus',
  'qwen/qwen3-coder',
  'google/gemini-3.5-flash',
  'openai/gpt-5.5',
  'deepseek/deepseek-v4-flash',
  'x-ai/grok-4',
];

const RESEARCH_TOP = [
  'google/gemini-3.1-pro-preview',
  'deepseek/deepseek-v4-pro',
  'z-ai/glm-5.2',
  'moonshotai/kimi-k2.7-code',
  'google/gemini-3.5-flash',
  'qwen/qwen3.7-max',
  'qwen/qwen3.7-plus',
  'x-ai/grok-4',
];

const WRITING_TOP = [
  'anthropic/claude-opus-4.8',
  'openai/gpt-5.5',
  'moonshotai/kimi-k2.7-code',
  'google/gemini-3.1-pro-preview',
  'z-ai/glm-5.2',
  'x-ai/grok-4',
];

const IMAGE_TOP = ['google/nano-banana-pro', 'google/gemini-3.5-flash', 'google/gemini-3.1-pro-preview'];
const VIDEO_TOP = ['bytedance/seedance-1-pro', 'google/gemini-3.5-flash', 'moonshotai/kimi-k2.7-code'];

export const AGENCY_DEPARTMENTS: AgencyDepartmentConfig[] = [
  {
    key: 'code',
    title: 'Code',
    description: 'Build, repair, review, and release software.',
    roles: [
      { id: 'code-architect', title: 'Systems Architect', description: 'Breaks the work into safe implementation slices.', category: 'coding', defaultModelId: 'deepseek/deepseek-v4-pro', options: CODE_TOP_10 },
      { id: 'code-implementer', title: 'Implementer', description: 'Writes the main patch and follows repo conventions.', category: 'coding', defaultModelId: 'openai/gpt-5.5', options: CODE_TOP_10 },
      { id: 'code-reviewer', title: 'Code Reviewer', description: 'Looks for regressions, missed edge cases, and weak tests.', category: 'coding', defaultModelId: 'z-ai/glm-5.2', options: CODE_TOP_10 },
      { id: 'code-qa', title: 'QA Runner', description: 'Chooses focused verification and release checks.', category: 'coding', defaultModelId: 'qwen/qwen3.7-plus', options: CODE_TOP_10 },
    ],
  },
  {
    key: 'design',
    title: 'Design',
    description: 'Interface, visual direction, image, and video generation.',
    roles: [
      { id: 'design-ui', title: 'Interface Designer', description: 'Chooses layout, hierarchy, interaction states, and polish.', category: 'design', defaultModelId: 'moonshotai/kimi-k2.7-code', options: CODE_TOP_10 },
      { id: 'design-image', title: 'Image Generator', description: 'Handles image generation or editing tasks only.', category: 'image', defaultModelId: 'google/nano-banana-pro', options: IMAGE_TOP },
      { id: 'design-video', title: 'Video Generator', description: 'Handles motion or generated video tasks only.', category: 'video', defaultModelId: 'bytedance/seedance-1-pro', options: VIDEO_TOP },
    ],
  },
  {
    key: 'research',
    title: 'Research',
    description: 'Find, compare, verify, and synthesize evidence.',
    roles: [
      { id: 'research-lead', title: 'Lead Researcher', description: 'Finds sources and frames the answer.', category: 'research', defaultModelId: 'google/gemini-3.1-pro-preview', options: RESEARCH_TOP },
      { id: 'research-checker', title: 'Source Checker', description: 'Checks freshness, citations, and unsupported claims.', category: 'research', defaultModelId: 'deepseek/deepseek-v4-pro', options: RESEARCH_TOP },
      { id: 'research-synth', title: 'Synthesizer', description: 'Turns the research into a concise recommendation.', category: 'writing', defaultModelId: 'z-ai/glm-5.2', options: RESEARCH_TOP },
    ],
  },
  {
    key: 'creative',
    title: 'Creative',
    description: 'Writing, concepts, brand, and story work.',
    roles: [
      { id: 'creative-director', title: 'Creative Director', description: 'Sets the concept and chooses the angle.', category: 'writing', defaultModelId: 'anthropic/claude-opus-4.8', options: WRITING_TOP },
      { id: 'creative-writer', title: 'Writer', description: 'Drafts the main creative output.', category: 'writing', defaultModelId: 'moonshotai/kimi-k2.7-code', options: WRITING_TOP },
      { id: 'creative-editor', title: 'Editor', description: 'Tightens tone, structure, and final polish.', category: 'writing', defaultModelId: 'openai/gpt-5.5', options: WRITING_TOP },
    ],
  },
  {
    key: 'strategy',
    title: 'Strategy',
    description: 'Plans, decisions, risk, and product sequencing.',
    roles: [
      { id: 'strategy-director', title: 'Strategy Director', description: 'Owns sequencing and tradeoffs.', category: 'strategy', defaultModelId: 'deepseek/deepseek-v4-pro', options: RESEARCH_TOP },
      { id: 'strategy-risk', title: 'Risk Reviewer', description: 'Finds operational, legal, and safety risks.', category: 'strategy', defaultModelId: 'x-ai/grok-4', options: RESEARCH_TOP },
      { id: 'strategy-product', title: 'Product Lead', description: 'Turns the plan into user-facing priorities.', category: 'strategy', defaultModelId: 'google/gemini-3.1-pro-preview', options: RESEARCH_TOP },
    ],
  },
  {
    key: 'generic',
    title: 'General',
    description: 'Triage, routing, and mixed tasks.',
    roles: [
      { id: 'general-triage', title: 'Triage Lead', description: 'Routes ambiguous work to the right department.', category: 'general', defaultModelId: 'deepseek/deepseek-v4-flash', options: RESEARCH_TOP },
      { id: 'general-coordinator', title: 'Coordinator', description: 'Keeps the handoff understandable and ordered.', category: 'general', defaultModelId: 'z-ai/glm-5.2', options: RESEARCH_TOP },
    ],
  },
];

export function normalizeAgencyBossId(value: unknown): AgencyBossId | null {
  const raw = String(value || '').trim().toLowerCase();
  const aliases: Record<string, AgencyBossId> = {
    opus: 'claude',
    'claude-opus-4-8': 'claude',
    'claude-opus-4.8': 'claude',
    'claude-opus-4-6': 'claude',
    'claude-opus-4.6': 'claude',
    'deepseekprov4': 'deepseek-v4-pro',
    'deepseek-pro-v4': 'deepseek-v4-pro',
    'deepseek-v4': 'deepseek-v4-pro',
    'glm5.1': 'glm-5-1',
    'glm-5.1': 'glm-5-1',
    'glm5.2': 'glm-5-1',
    'glm-5.2': 'glm-5-1',
    'kimi2.7': 'kimi-k2-7-code',
    'kimi-k2.7': 'kimi-k2-7-code',
    gemini: 'gemini-latest',
    qwen: 'qwen-best',
  };
  const normalized = aliases[raw] || raw;
  return AGENCY_BOSS_ROSTER.some((boss) => boss.id === normalized) ? (normalized as AgencyBossId) : null;
}

export function agencyBossById(value: unknown): AgencyBossOption {
  const id = normalizeAgencyBossId(value) || DEFAULT_AGENCY_BOSS_ID;
  return AGENCY_BOSS_ROSTER.find((boss) => boss.id === id) || AGENCY_BOSS_ROSTER[0];
}

export function agencyBossExecutorFor(value: unknown): 'codex' | 'claude' {
  return agencyBossById(value).executor;
}

export function modelOptionById(id: string): AgencyModelOption {
  return AGENCY_MODEL_OPTIONS.find((model) => model.id === id) || {
    id,
    label: id.split('/').pop()?.replace(/[-_]/g, ' ') || id,
    family: id.split('/')[0] || 'Model',
    category: 'general',
    description: 'Available model from the Agency roster.',
  };
}

export function defaultDepartmentAssignments(): Record<string, string> {
  return Object.fromEntries(
    AGENCY_DEPARTMENTS.flatMap((department) =>
      department.roles.map((role) => [role.id, role.defaultModelId]),
    ),
  );
}
