import { NextAuthOptions } from 'next-auth';
import {
  deleteAssistantTheme,
  getAllThemes,
  getAssistantTheme,
  updateAssistantTheme,
  upsertAssistantTheme
} from '../src/core/actions/assistantTheme-actions';
import {
  DefaultThemeConfig,
  IAssistantTheme
} from '../src/core/blocks/assistantTheme.block';
import { createTestAssistant, createTestTenant } from '../src/testing/testlib';
// Create auth options for testing
import { createAuthOptions } from '../src/core/auth/authOptions';

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}));

describe('AssistantTheme Actions', () => {
  let authOptions: NextAuthOptions;
  beforeAll(() => {
    // Use a test config object for createAuthOptions
    authOptions = createAuthOptions({
      appType: 'interface',
      baseUrl: 'http://localhost:3000',
      googleCredentials: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret'
      }
    });
  });

  it('should get assistant theme and return default if not found', async () => {
    const tenant = await createTestTenant();
    const assistantName = 'Get Theme Assistant';
    const assistantResponse = await createTestAssistant({ name: assistantName, tenantId: tenant._id! });
    expect(assistantResponse._id).not.toBeNull();
    const assistant_id = assistantResponse._id!;

    const theme = await getAssistantTheme(assistant_id, assistantName);
    expect(theme).toBeDefined();
    expect(theme.assistant_id).toEqual(assistant_id);
    expect(theme.assistant_name).toEqual(assistantName);
    expect(theme.enabled).toEqual(false);
    expect(theme.theme_config).toEqual(DefaultThemeConfig);
  });

  it('should create a new assistant theme successfully', async () => {
    const tenant = await createTestTenant();
    const assistantName = 'Create Theme Assistant';
    const assistantResponse = await createTestAssistant({ name: assistantName, tenantId: tenant._id! });
    expect(assistantResponse._id).not.toBeNull();
    const assistant_id = assistantResponse._id!;

    const themeData = {
      assistant_id: assistant_id,
      assistant_name: assistantName,
      enabled: true,
      theme_config: {
        colors: {
          primary: '#FF5733',
          secondary: '#33FF57',
          accent: '#3357FF',
          background: '#000000',
          surface: '#1a1a1a',
          text: {
            primary: '#ffffff',
            secondary: '#cccccc',
            accent: '#FFD700',
          },
        },
        components: {
          button: {
            sizes: {
              active: { width: '80px', height: '80px' },
              inactive: { width: '75px', height: '75px' },
            },
          },
          logo: {
            src: '/images/custom-logo.png',
            alt: 'Custom Logo',
          },
          branding: {
            ringText: 'Custom Ring Text',
            smsNumbers: { 'US': '+1234567890' },
          },
        },
        typography: {
          linkText: {
            more: 'Learn more →',
          },
        },
      },
    } as IAssistantTheme;

    const result = await upsertAssistantTheme(themeData, authOptions);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.assistant_id).toEqual(assistant_id);
    expect(result.data?.enabled).toEqual(true);
    expect(result.data?.theme_config.colors.primary).toEqual('#FF5733');
  });

  it('should update an existing assistant theme', async () => {
    const tenant = await createTestTenant();
    const assistantName = 'Update Theme Assistant';
    const assistantResponse = await createTestAssistant({ name: assistantName, tenantId: tenant._id! });
    expect(assistantResponse._id).not.toBeNull();
    const assistant_id = assistantResponse._id!;

    const initialThemeData = {
      assistant_id: assistant_id,
      assistant_name: assistantName,
      enabled: false,
      theme_config: DefaultThemeConfig,
    } as IAssistantTheme;

    const createResult = await upsertAssistantTheme(initialThemeData, authOptions);
    expect(createResult.success).toBe(true);

    const updateData = {
      enabled: true,
      theme_config: {
        ...DefaultThemeConfig,
        colors: {
          ...DefaultThemeConfig.colors,
          primary: '#FF0000',
        },
      },
    };

    const updateResult = await updateAssistantTheme(assistant_id, updateData, authOptions);
    expect(updateResult.success).toBe(true);
    expect(updateResult.data).toBeDefined();
    expect(updateResult.data?.enabled).toEqual(true);
    expect(updateResult.data?.theme_config.colors.primary).toEqual('#FF0000');
  });

  it('should upsert an existing assistant theme', async () => {
    const tenant = await createTestTenant();
    const assistantName = 'Upsert Theme Assistant';
    const assistantResponse = await createTestAssistant({name: assistantName, tenantId: tenant._id!});
    expect(assistantResponse._id).not.toBeNull();
    const assistant_id = assistantResponse._id;

    const initialThemeData = {
      assistant_id: assistant_id,
      assistant_name: assistantName,
      enabled: false,
      theme_config: DefaultThemeConfig,
    } as IAssistantTheme;

    const createResult = await upsertAssistantTheme(initialThemeData, authOptions);
    expect(createResult.success).toBe(true);

    const upsertData = {
      assistant_id: assistant_id,
      assistant_name: assistantName,
      enabled: true,
      theme_config: {
        ...DefaultThemeConfig,
        colors: {
          ...DefaultThemeConfig.colors,
          primary: '#00FF00',
        },
      },
    };

    const upsertResult = await upsertAssistantTheme(upsertData, authOptions);
    expect(upsertResult.success).toBe(true);
    expect(upsertResult.data).toBeDefined();
    expect(upsertResult.data?.enabled).toEqual(true);
    expect(upsertResult.data?.theme_config.colors.primary).toEqual('#00FF00');
  });

  it('should delete an assistant theme successfully', async () => {
    const tenant = await createTestTenant();
    const assistantName = 'Delete Theme Assistant';
    const assistantResponse = await createTestAssistant({name: assistantName, tenantId: tenant._id!});
    expect(assistantResponse._id).not.toBeNull();
    const assistant_id = assistantResponse._id!;

    const themeData = {
      assistant_id: assistant_id,
      assistant_name: assistantName,
      enabled: true,
      theme_config: DefaultThemeConfig,
    } as IAssistantTheme;

    const createResult = await upsertAssistantTheme(themeData, authOptions);
    expect(createResult.success).toBe(true);

    const deleteResult = await deleteAssistantTheme(assistant_id, authOptions);
    expect(deleteResult.success).toBe(true);

    const theme = await getAssistantTheme(assistant_id, assistantName);
    expect(theme.enabled).toEqual(false);
  });

  it('should return error when deleting non-existent theme', async () => {
    const nonExistentAssistantId = '00000000-0000-0000-2222-000000000000';
    const deleteResult = await deleteAssistantTheme(nonExistentAssistantId, authOptions);
    expect(deleteResult.success).toBe(false);
    expect(deleteResult.error).toEqual('Theme not found');
  });

  it('should return error when updating non-existent theme', async () => {
    const nonExistentAssistantId = '00000000-0000-0000-3333-000000000000';
    const updateData = {
      enabled: true,
      theme_config: DefaultThemeConfig,
    };
    const updateResult = await updateAssistantTheme(nonExistentAssistantId, updateData, authOptions);
    expect(updateResult.success).toBe(false);
    expect(updateResult.error).toEqual('Theme not found');
  });

  it('should get all themes successfully', async () => {
    const tenant = await createTestTenant();
    const assistant1Name = 'All Themes Assistant 1';
    const assistant2Name = 'All Themes Assistant 2';
    const assistant1Response = await createTestAssistant({ name: assistant1Name, tenantId: tenant._id! });
    const assistant2Response = await createTestAssistant({ name: assistant2Name, tenantId: tenant._id! });
    expect(assistant1Response._id).not.toBeNull();
    expect(assistant2Response._id).not.toBeNull();

    const theme1Data = {
      assistant_id: assistant1Response._id,
      assistant_name: assistant1Name,
      enabled: true,
      theme_config: DefaultThemeConfig,
    } as IAssistantTheme;

    const theme2Data = {
      assistant_id: assistant2Response._id,
      assistant_name: assistant2Name,
      enabled: false,
      theme_config: {
        ...DefaultThemeConfig,
        colors: {
          ...DefaultThemeConfig.colors,
          primary: '#FF0000',
        },
      },
    } as IAssistantTheme;

    const create1Result = await upsertAssistantTheme(theme1Data, authOptions);
    const create2Result = await upsertAssistantTheme(theme2Data, authOptions);
    expect(create1Result.success).toBe(true);
    expect(create2Result.success).toBe(true);

    const allThemesResult = await getAllThemes(authOptions);
    expect(allThemesResult.success).toBe(true);
    expect(allThemesResult.data).toBeDefined();
    expect(Array.isArray(allThemesResult.data)).toBe(true);
    const ourThemes = allThemesResult.data?.filter(theme => 
      theme.assistant_id === assistant1Response._id || 
      theme.assistant_id === assistant2Response._id
    );
    expect(ourThemes?.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle theme validation errors gracefully', async () => {
    const tenant = await createTestTenant();
    const assistantName = 'Invalid Theme Assistant';
    const assistantResponse = await createTestAssistant({ name: assistantName, tenantId: tenant._id! });
    expect(assistantResponse._id).not.toBeNull();
    const assistant_id = assistantResponse._id;

    const invalidThemeData = {
      assistant_id: assistant_id,
      lens_flare: true, // Invalid field
    } as Partial<IAssistantTheme>;

    const result = await upsertAssistantTheme(invalidThemeData, authOptions);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
}); 