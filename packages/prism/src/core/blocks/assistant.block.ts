import z from 'zod';
// Avoid compile-time dependency on @nia/features here to keep this package buildable in isolation.
// FeatureKey is a string union in @nia/features; we use a local alias to prevent TS rootDir issues during tests/build.
type FeatureKey = string;

export const BlockType_Assistant = 'Assistant';

// Define subclasses used within IAssistant
export interface IFunction {
  name: string;
  async: boolean;
  description: string;
  parameters?: {
    type: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties?: any,
  },
  serverUrl?: string,
}

export enum MessageRoleType {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
  TOOL = 'tool',
  FUNCTION = 'function',
}


export enum ToolType {
  FUNCTION = 'function',
  OUTPUT = 'output',
  BASH = 'bash',
  COMPUTER = 'computer',
  TEXT_EDITOR = 'textEditor'
}

export enum ToolBaseType {
  PHOTOS = 'photos',
  MAP = 'map'
}

export enum MessageType {
  REQUEST_START = 'request-start',
  REQUEST_COMPLETE = 'request-complete',
  REQUEST_FAILED = 'request-failed',
  REQUEST_RESPONSE_DELAYED = 'request-response-delayed',
}

export enum MessageRole {
  ASSISTANT = 'assistant',
  SYSTEM = 'system'
}

export interface ITool {
  _id?: string;
  type: ToolType;
  baseType?: ToolBaseType;
  async: boolean;
  userId?: string;
  function?: {
    name?: string;
    strict?: boolean;
    description?: string;
    parameters?: {
      type: string;
      properties: Record<string, { type: string; description?: string }>;
      required: string[];
    };
  };
  messages?: {
    start?: {
      type: MessageType,
      content: string;
      role?: MessageRole;
    };
    delayed?: {
      type: MessageType,
      content: string;
      role?: MessageRole;
      timingMilliseconds?: number;
    };
    completed?: {
      type: MessageType,
      content: string;
      role?: MessageRole;
    };
    failed?: {
      type: MessageType,
      content: string;
      role?: MessageRole;
    };
  };
  server?: {
    url?: string;
    timeoutSeconds?: string;
    secret?: string;
    headers?: Record<string, string>;
  };
}

export interface IModel {
  provider: string;
  model: string;
  emotionRecognitionEnabled?: boolean;
  knowledgeBase?: {
    server: {
      url: string;
      timeoutSeconds?: number;
      secret?: string;
      headers?: Record<string, string>;
    };
  };
  knowledgeBaseId?: string;
  maxTokens?: number;
  messages?: Array<{
    role: MessageRoleType;
    content: string;
  }>;
  numFastTurns?: number;
  temperature?: number;
  tools?: ITool[];
  systemPrompt?: string;
  functions?: IFunction[],
}

export enum VoiceProviderType {
  AZURE = 'azure',
  CARTESIA = 'cartesia',
  CUSTOM_VOICE = 'custom-voice',
  DEEPGRAM = 'deepgram',
  ELEVEN_LABS = '11labs',
  KOKORO = 'kokoro',
  LMNT = 'lmnt',
  NEETS = 'neets',
  PLAYHT = 'playht',
  RIME_AI = 'rime-ai',
  TAVUS = 'tavus',
}

export interface VoiceFallbackPlan {
  voices: Array<{
    provider: VoiceProviderType
    voiceId: string;
  }>;
}

/**
 * Configuration for a personality's voice settings.
 * Used in allowedPersonalities map to store voice provider and parameters per personality.
 */
export interface PersonalityVoiceConfig {
  personalityId: string;
  personalityName: string;
  personaName: string;
  voice: IVoice;
}

export type ModePersonalityVoiceConfig = Record<string, PersonalityVoiceConfig & {
  room_name: string;
}>;

export interface IVoice {
  provider: VoiceProviderType;
  voiceId: string;
  callbackUrl?: string;
  conversationName?: string;
  conversationalContext?: string;
  customGreeting?: string;
  fallbackPlan?: VoiceFallbackPlan;
  personaId?: string;
  model?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
  optimizeStreamingLatency?: number;
  maxCallDuration?: number;
  participantLeftTimeout?: number;
  participantAbsentTimeout?: number;
  enableRecording?: boolean;
  enableTranscription?: boolean;
  applyGreenscreen?: boolean;
  language?: string;
  recordingS3BucketName?: string;
  recordingS3BucketRegion?: string;
  awsAssumeRoleArn?: string;
}

export enum TranscriberProviderType {
  ASSEMBLY_AI = 'assembly-ai',
  DEEPGRAM = 'deepgram',
  GLADIA = 'gladia',
  SPEECHMATICS = 'speechmatics',
  TALKSCRIBER = 'talkscriber',
  ELEVEN_LABS = '11labs',
}

export enum TranscriberModelType {
  NOVA_2_GENERAL = 'nova-2-general',
  NOVA_2 = 'nova-2',
  NOVA_3 = 'nova-3',
  NOVA_3_GENERAL = 'nova-3-general',
  NOVA_2_MEETING = 'nova-2-meeting',
  NOVA_2_PHONE_CALL = 'nova-2-phone-call',
  NOVA_2_FINANCE = 'nova-2-finance',
  NOVA_2_CONVERSATIONAL_AI = 'nova-2-conversationalai',
  NOVA_2_VOICEMAIL = 'nova-2-voicemail',
  NOVA_2_VIDEO = 'nova-2-video',
  NOVA_2_MEDICAL = 'nova-2-medical',
  NOVA_2_DRIVETHRU = 'nova-2-drivethru',
  NOVA_2_AUTOMOTIVE = 'nova-2-automotive',
  SCRIBE_V1 = 'scribe_v1',
}

export enum TranscriberLanguageType {
  AA = 'aa',
  AB = 'ab',
  AE = 'ae',
  AF = 'af',
  AK = 'ak',
  AM = 'am',
  AN = 'an',
  AR = 'ar',
  AS = 'as',
  AV = 'av',
  AY = 'ay',
  AZ = 'az',
  BA = 'ba',
  BE = 'be',
  BG = 'bg',
  BH = 'bh',
  BI = 'bi',
  BM = 'bm',
  BN = 'bn',
  BO = 'bo',
  BR = 'br',
  BS = 'bs',
  CA = 'ca',
  CE = 'ce',
  CH = 'ch',
  CO = 'co',
  CR = 'cr',
  CS = 'cs',
  CU = 'cu',
  CV = 'cv',
  CY = 'cy',
  DA = 'da',
  DE = 'de',
  DV = 'dv',
  DZ = 'dz',
  EE = 'ee',
  EL = 'el',
  EN = 'en',
  EO = 'eo',
  ES = 'es',
  ET = 'et',
  EU = 'eu',
  FA = 'fa',
  FF = 'ff',
  FI = 'fi',
  FJ = 'fj',
  FO = 'fo',
  FR = 'fr',
  FY = 'fy',
  GA = 'ga',
  GD = 'gd',
  GL = 'gl',
  GN = 'gn',
  GU = 'gu',
  GV = 'gv',
  HA = 'ha',
  HE = 'he',
  HI = 'hi',
  HO = 'ho',
  HR = 'hr',
  HT = 'ht',
  HU = 'hu',
  HY = 'hy',
  HZ = 'hz',
  IA = 'ia',
  ID = 'id',
  IE = 'ie',
  IG = 'ig',
  II = 'ii',
  IK = 'ik',
  IO = 'io',
  IS = 'is',
  IT = 'it',
  IU = 'iu',
  JA = 'ja',
  JV = 'jv',
  KA = 'ka',
  KG = 'kg',
  KI = 'ki',
  KJ = 'kj',
  KK = 'kk',
  KL = 'kl',
  KM = 'km',
  KN = 'kn',
  KO = 'ko',
  KR = 'kr',
  KS = 'ks',
  KU = 'ku',
  KV = 'kv',
  KW = 'kw',
  KY = 'ky',
  LA = 'la',
  LB = 'lb',
  LG = 'lg',
  LI = 'li',
  LN = 'ln',
  LO = 'lo',
  LT = 'lt',
  LU = 'lu',
  LV = 'lv',
  MG = 'mg',
  MH = 'mh',
  MI = 'mi',
  MK = 'mk',
  ML = 'ml',
  MN = 'mn',
  MR = 'mr',
  MS = 'ms',
  MT = 'mt',
  MY = 'my',
  NA = 'na',
  NB = 'nb',
  ND = 'nd',
  NE = 'ne',
  NG = 'ng',
  NL = 'nl',
  NN = 'nn',
  NO = 'no',
  NR = 'nr',
  NV = 'nv',
  NY = 'ny',
  OC = 'oc',
  OJ = 'oj',
  OM = 'om',
  OR = 'or',
  OS = 'os',
  PA = 'pa',
  PI = 'pi',
  PL = 'pl',
  PS = 'ps',
  PT = 'pt',
  QU = 'qu',
  RM = 'rm',
  RN = 'rn',
  RO = 'ro',
  RU = 'ru',
  RW = 'rw',
  SA = 'sa',
  SC = 'sc',
  SD = 'sd',
  SE = 'se',
  SG = 'sg',
  SI = 'si',
  SK = 'sk',
  SL = 'sl',
  SM = 'sm',
  SN = 'sn',
  SO = 'so',
  SQ = 'sq',
  SR = 'sr',
  SS = 'ss',
  ST = 'st',
  SU = 'su',
  SV = 'sv',
  SW = 'sw',
  TA = 'ta',
  TE = 'te',
  TG = 'tg',
  TH = 'th',
  TI = 'ti',
  TK = 'tk',
  TL = 'tl',
  TN = 'tn',
  TO = 'to',
  TR = 'tr',
  TS = 'ts',
  TT = 'tt',
  TW = 'tw',
  TY = 'ty',
  UG = 'ug',
  UK = 'uk',
  UR = 'ur',
  UZ = 'uz',
  VE = 've',
  VI = 'vi',
  VO = 'vo',
  WA = 'wa',
  WO = 'wo',
  XH = 'xh',
  YI = 'yi',
  YO = 'yo',
  YUE = 'yue',
  ZA = 'za',
  ZH = 'zh',
  ZU = 'zu',
  DA_DK = 'da-DK',
  DE_CH = 'de-CH',
  EN_AU = 'en-AU',
  EN_GB = 'en-GB',
  EN_IN = 'en-IN',
  EN_NZ = 'en-NZ',
  EN_US = 'en-US',
  ES_419 = 'es-419',
  ES_LATAM = 'es-LATAM',
  FR_CA = 'fr-CA',
  HI_LATN = 'hi-Latn',
  KO_KR = 'ko-KR',
  MULTI = 'multi',
  NL_BE = 'nl-BE',
  PT_BR = 'pt-BR',
  SV_SE = 'sv-SE',
  TAQ = 'taq',
  TH_TH = 'th-TH',
  ZH_CN = 'zh-CN',
  ZH_HANS = 'zh-Hans',
  ZH_HANT = 'zh-Hant',
  ZH_TW = 'zh-TW',
}

export interface ITranscriber {
  provider: TranscriberProviderType;
  model: TranscriberModelType;
  language: TranscriberLanguageType,
  backgroundDenoising?: boolean;
  endCall?: boolean;
  stopSpeakingPlan?: {
    numWords?: number;
    voiceSeconds?: number;
    backoffSeconds?: number;
  };
}
export enum ClientMessageType {
  CONVERSATION_UPDATE = 'conversation-update',
  FUNCTION_CALL = 'function-call',
  HANG = 'hang',
  MODEL_OUTPUT = 'model-output',
  SPEECH_UPDATE = 'speech-update',
  STATUS_UPDATE = 'status-update',
  TRANSFER_UPDATE = 'transfer-update',
  TRANSCRIPT = 'transcript',
  TOOL_CALLS = 'tool-calls',
  USER_INTERRUPTED = 'user-interrupted',
  VOICE_INPUT = 'voice-input',
}

export enum ServerMessageType {
  CONVERSATION_UPDATE = 'conversation-update',
  END_OF_CALL_REPORT = 'end-of-call-report',
  FUNCTION_CALL = 'function-call',
  HANG = 'hang',
  SPEECH_UPDATE = 'speech-update',
  STATUS_UPDATE = 'status-update',
  TOOL_CALLS = 'tool-calls',
  TRANSFER_DESTINATION_REQUEST = 'transfer-destination-request',
  USER_INTERRUPTED = 'user-interrupted',
}

export interface IAssistant {
  _id?: string,
  tenantId: string,
  subDomain?: string,
  // Configuration for personality and voice per desktop mode
  modePersonalityVoiceConfig?: ModePersonalityVoiceConfig,
  // Configuration for personality and voice for DailyCall/Social contexts
  dailyCallPersonalityVoiceConfig?: ModePersonalityVoiceConfig,
  // Map of user-selectable personalities with their voice configurations
  allowedPersonalities?: Record<string, PersonalityVoiceConfig>,
  // Initial desktop mode preference for Interface background
  desktopMode?: 'default' | 'home' | 'work' | 'creative' | 'gaming' | 'focus' | 'relaxation' | 'quiet',
  model?: IModel,
  generationModelConfig?: Array<{
    provider: string;
    model: string;
  }>,
  assistantPhoneNumber?: string,
  backchannelingEnabled?: boolean,
  backgroundDenoisingEnabled?: boolean,
  backgroundSound?: string,
  clientMessages?: string[],
  contentTypes?: string[],
  credentialIds?: string[],
  emotionRecognitionEnabled?: boolean,
  endCall?: boolean,
  endCallMessage?: string,
  endCallPhrases?: string[],
  firstMessage?: string,
  firstMessageMode?: string,
  hipaaEnabled?: boolean,
  is_template?: boolean,
  knowledgeBase?: Record<string, unknown>,
  knowledgeBaseId?: string,
  messages?: Array<Record<string, unknown>>,
  template_category?: number,
  template_display_name?: string,
  template_description?: string,
  template_icon_url?: string,
  maxDurationSeconds?: number,
  metadata?: Record<string, string>,
  modelOutputInMessagesEnabled?: boolean,
  name: string,
  openAITools?: string[],
  serverHeaders?: Record<string, string>,
  serverMessages?: ServerMessageType[],
  serverSecret?: string,
  serverTimeoutSeconds?: number,
  serverUrl?: string,
  silenceTimeoutSeconds?: number,
  special_instructions?: string,
  // Access / Features controls
  allowAnonymousLogin?: boolean,
  startFullScreen?: boolean,
  supportedFeatures?: FeatureKey[],
  transcriber?: ITranscriber,
  user?: string,
  voiceProvider?: 'pipecat',
  createdAt?: Date; // special case for assistant, provide low level timestamps to top level object
  updatedAt?: Date; // special case for assistant, provide low level timestamps to top level object
};

export const VoiceSchema = z.object({
  provider: z.nativeEnum(VoiceProviderType),
  voiceId: z.string(),
  callbackUrl: z.string().optional(),
  conversationName: z.string().optional(),
  conversationalContext: z.string().optional(),
  customGreeting: z.string().optional(),
  fallbackPlan: z.object({
    voices: z.array(z.object({
      provider: z.nativeEnum(VoiceProviderType),
      voiceId: z.string(),
    })),
  }).optional(),
  personaId: z.string().optional(),
  model: z.string().optional(),
  stability: z.number().optional(),
  similarityBoost: z.number().optional(),
  style: z.number().optional(),
  speed: z.number().optional(),
  optimizeStreamingLatency: z.number().optional(),
  maxCallDuration: z.number().optional(),
  participantLeftTimeout: z.number().optional(),
  participantAbsentTimeout: z.number().optional(),
  enableRecording: z.boolean().optional(),
  enableTranscription: z.boolean().optional(),
  applyGreenscreen: z.boolean().optional(),
  language: z.nativeEnum(TranscriberLanguageType).optional(),
  recordingS3BucketName: z.string().optional(),
  recordingS3BucketRegion: z.string().optional(),
  awsAssumeRoleArn: z.string().optional(),
});

export const PersonalityVoiceConfigSchema = z.object({
  personalityId: z.string(),
  personalityName: z.string(),
  personaName: z.string(),
  voice: VoiceSchema,
});

export const AssistantSchema = z.object({
  _id: z.string().optional(),
  name: z.string(),
  tenantId: z.string().min(1, 'tenantId is required'),
  subDomain: z.string().optional(),
  modePersonalityVoiceConfig: z.record(z.string(), PersonalityVoiceConfigSchema.extend({
    room_name: z.string(),
  })).optional(),
  dailyCallPersonalityVoiceConfig: z.record(z.string(), PersonalityVoiceConfigSchema.extend({
    room_name: z.string(),
  })).optional(),
  allowedPersonalities: z.record(z.string(), PersonalityVoiceConfigSchema).optional(),
  special_instructions: z.string().optional(),
  desktopMode: z.enum(['default', 'home', 'work', 'creative', 'gaming', 'focus', 'relaxation', 'quiet']).default('home').optional(),
  allowAnonymousLogin: z.boolean().default(false).optional(),
  startFullScreen: z.boolean().default(false).optional(),
  supportedFeatures: z.array(z.custom<FeatureKey>((v): v is FeatureKey => typeof v === 'string')).optional(),
  model: z.object({
    provider: z.string(),
    model: z.string(),
    systemPrompt: z.string().optional(),
    numFastTurns: z.number().optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    tools: z.array(z.string()).optional(),
    functions: z.array(z.any()).optional(),
  }).optional(),
  generationModelConfig: z.array(z.object({
    provider: z.string(),
    model: z.string(),
  })).optional(),
  transcriber: z.object({
    provider: z.nativeEnum(TranscriberProviderType),
    model: z.nativeEnum(TranscriberModelType),
    language: z.nativeEnum(TranscriberLanguageType),
    backgroundDenoising: z.boolean().optional(),
  }).optional(),
  firstMessage: z.string().optional(),
  backgroundSound: z.string().optional(),
  is_template: z.boolean().optional(),
  template_category: z.number().optional(),
  template_display_name: z.string().optional(),
  template_description: z.string().optional(),
  template_icon_url: z.string().optional(),
  assistantPhoneNumber: z.string().optional(),
  backchannelingEnabled: z.boolean().optional(),
  backgroundDenoisingEnabled: z.boolean().optional(),
  contentTypes: z.array(z.string()).optional(),
  credentialIds: z.array(z.string()).optional(),
  emotionRecognitionEnabled: z.boolean().optional(),
  endCall: z.boolean().optional(),
  endCallMessage: z.string().optional(),
  endCallPhrases: z.array(z.string()).optional(),
  firstMessageMode: z.string().optional(),
  hipaaEnabled: z.boolean().optional(),
  maxDurationSeconds: z.number().optional(),
  metadata: z.record(z.any()).optional(),
  modelOutputInMessagesEnabled: z.boolean().optional(),
  openAITools: z.array(z.string()).optional(),
  serverHeaders: z.record(z.string()).optional(),
  serverMessages: z.array(z.any()).optional(),
  serverSecret: z.string().optional(),
  serverTimeoutSeconds: z.number().optional(),
  serverUrl: z.string().optional(),
  silenceTimeoutSeconds: z.number().optional(),
  user: z.string().optional(),
  knowledgeBase: z.record(z.any()).optional(),
  knowledgeBaseId: z.string().optional(),
  messages: z.array(z.record(z.any())).optional(),
  clientMessages: z.array(z.string()).optional(),
  voiceProvider: z.enum(['pipecat']).default('pipecat').optional(),
  createdAt: z.date().optional(), // special case for assistant, provide low level timestamps to top level object
  updatedAt: z.date().optional(), // special case for assistant, provide low level timestamps to top level object
});
