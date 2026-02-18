import { z } from 'zod';

export const BlockType_AssistantTheme = 'AssistantTheme';

// Theme configuration schema
export const ThemeConfigSchema = z.object({
  colors: z.object({
    primary: z.string().default('#8EC6FF'),
    secondary: z.string().default('#FFDA77'),
    accent: z.string().default('#FFD700'),
    background: z.string().default('#000000'),
    surface: z.string().default('#1a1a1a'),
    text: z.object({
      primary: z.string().default('#ffffff'),
      secondary: z.string().default('#6b7280'),
      accent: z.string().default('#2563eb'),
    }),
  }),
  components: z.object({
    button: z.object({
      sizes: z.object({
        active: z.object({
          width: z.string().default('64px'),
          height: z.string().default('64px'),
        }),
        inactive: z.object({
          width: z.string().default('62.5px'),
          height: z.string().default('62.5px'),
        }),
      }),
    }),
    logo: z.object({
      src: z.string().default('/images/default-logo.png'),
      alt: z.string().default('Default'),
    }),
    branding: z.object({
      ringText: z.string().default(''),
      smsNumbers: z.record(z.string()).default({}),
    }),
  }),
  typography: z.object({
    linkText: z.object({
      more: z.string().default('Tell me more →'),
    }),
  }),
});

// Type exports
export type IThemeConfig = z.infer<typeof ThemeConfigSchema>;
export interface IAssistantTheme {
  _id?: string;
  assistant_id: string;
  assistant_name: string;
  enabled: boolean;
  theme_config: IThemeConfig;
  createdAt?: Date;
  updatedAt?: Date;
}

// Default theme configuration
export const DefaultThemeConfig: IThemeConfig = {
  colors: {
    primary: '#8EC6FF',
    secondary: '#FFDA77',
    accent: '#FFD700',
    background: '#000000',
    surface: '#1a1a1a',
    text: {
      primary: '#ffffff',
      secondary: '#6b7280',
      accent: '#2563eb',
    },
  },
  components: {
    button: {
      sizes: {
        active: { width: '64px', height: '64px' },
        inactive: { width: '62.5px', height: '62.5px' },
      },
    },
    logo: {
      src: '/images/default-logo.png',
      alt: 'Default',
    },
    branding: {
      ringText: '',
      smsNumbers: {},
    },
  },
  typography: {
    linkText: {
      more: 'Tell me more →',
    },
  },
};

// Default assistant theme
export const DefaultAssistantTheme: IAssistantTheme = {
  assistant_id: '',
  assistant_name: '',
  enabled: false,
  theme_config: DefaultThemeConfig,
};
