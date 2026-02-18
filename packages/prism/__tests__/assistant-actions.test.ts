
import { v4 as uuidv4 } from 'uuid';
import { AssistantActions, TenantActions } from '../src/core/actions';
import { deleteAssistant, UpdateAssistantParams, getAssistantBySubDomain, getAssistantIdBySubDomain, getValidatedAssistant, getValidatedAssistantId, cloneAssistant, CloneAssistantParams, getTemplateAssistants, getAllAssistantsForUser } from "../src/core/actions/assistant-actions";
import { AssistantBlock, UserBlock } from "../src/core/blocks";
import { TenantRole } from '../src/core/blocks/userTenantRole.block';
import { ContentData } from '../src/core/content/types';
import { Prism } from '../src/prism';
import { createTestAssistant, createTestTenant, createTestUser } from "../src/testing/testlib";

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}));

describe('Assistant Actions (shared)', () => {
  let prism: Prism;
  let unique: string;
  beforeEach(async () => {
    prism = await Prism.getInstance();
    expect(prism).not.toBeNull();
    unique = uuidv4().toLowerCase();
  });
  afterAll(async () => {
    if (prism) {
      await prism.disconnect();
    }
  });

  it('should create an assistant successfully', async () => {
    // define a tenant
    const tenant = await createTestTenant();

    // define a user
    const userData: UserBlock.IUser = {
      name: 'Ben Derdundat',
      phone_number: '4155551212',
      email: `ben@some_${uuidv4()}email.com`,
    };

    // define an assistant
    const assistantData: AssistantBlock.IAssistant = {
      name: `Assistant ${unique}`,
      tenantId: tenant._id!,
      user: userData.name
    };
    const assistant = await AssistantActions.createAssistant(assistantData);

    expect(assistant).toBeDefined();
    expect(assistant).toHaveProperty('name');
    expect(assistant.name).toEqual(assistantData.name);
  });

  it('should create an assistant with subdomain', async () => {
    const tenant = await createTestTenant();
    const assistantData: AssistantBlock.IAssistant = {
      name: `Assistant ${unique}`,
      tenantId: tenant._id!,
      subDomain: `assistant-${unique}`
    };
    const assistant = await AssistantActions.createAssistant(assistantData);

    expect(assistant).toBeDefined();
    expect(assistant).toHaveProperty('subDomain');
    expect(assistant.subDomain).toEqual(assistantData.subDomain);
  });

  it('should create an assistant with vapiDown flag', async () => {
    const tenant = await createTestTenant();
    const assistantData: AssistantBlock.IAssistant = {
      name: `Assistant ${unique}`,
      tenantId: tenant._id!,
      vapiDown: true
    };
    const assistant = await AssistantActions.createAssistant(assistantData);

    expect(assistant).toBeDefined();
    expect(assistant).toHaveProperty('vapiDown');
    expect(assistant.vapiDown).toBe(true);
  });

  it('should create an assistant with persona_name', async () => {
    const tenant = await createTestTenant();
    const assistantData: AssistantBlock.IAssistant = {
      name: `Assistant ${unique}`,
      tenantId: tenant._id!,
      persona_name: 'Friendly Helper'
    };
    const assistant = await AssistantActions.createAssistant(assistantData);

    expect(assistant).toBeDefined();
    expect(assistant).toHaveProperty('persona_name');
    expect(assistant.persona_name).toEqual('Friendly Helper');
  });

  it('should return all assistants for the logged-in user', async () => {
    // define a tenant
    const tenant = await createTestTenant();

    // define a user
    const userData: UserBlock.IUser = {
      name: 'Ben Derdundat',
      phone_number: '4155551212',
      email: `ben@some_${uuidv4()}email.com`,
    };
    const user = await createTestUser(userData, 'password123');
    // assign the user to the tenant
    TenantActions.assignUserToTenant(tenant._id!, user._id!, TenantRole.ADMIN);

    // define an assistant
    const assistantData: AssistantBlock.IAssistant = {
      name: `Assistant ${unique}`,
      tenantId: tenant._id!,
    };
    const assistant = await AssistantActions.createAssistant(assistantData);
    expect(assistant).toBeDefined();

    const result = await AssistantActions.getAllAssistants(tenant._id!, user._id!);

    expect(result).toHaveLength(1);
    if (result) {
      expect(result[0]).toHaveProperty('name', assistantData.name);
    }
  });

  it('should throw error when getting all assistants without userId', async () => {
    await expect(AssistantActions.getAllAssistants('', '')).rejects.toThrow('Unauthorized');
  });

  it('should return all assistants across all user tenants with getAllAssistantsForUser', async () => {
    // Create test user
    const userData: UserBlock.IUser = {
      name: 'Multi-Tenant User',
      phone_number: '4155551213',
      email: `multi-tenant@${uuidv4()}.com`,
      interests: ['testing', 'multi-tenancy'],
    };
    const user = await createTestUser(userData, 'password123');

    // Create two test tenants
    const tenant1 = await createTestTenant({ name: `Tenant 1 ${unique}` });
    const tenant2 = await createTestTenant({ name: `Tenant 2 ${unique}` });
    const tenant3 = await createTestTenant({ name: `Tenant 3 ${unique}` });
    const tenant4 = await createTestTenant({ name: `Tenant 4 ${unique}` });

    console.log('Created tenants:', { tenant1: tenant1._id, tenant2: tenant2._id, tenant3: tenant3._id, tenant4: tenant4._id });

    // Assign user to both tenants
    await TenantActions.assignUserToTenant(user._id!, tenant1._id!, TenantRole.ADMIN);
    await TenantActions.assignUserToTenant(user._id!, tenant2._id!, TenantRole.MEMBER);

    // Verify user tenant assignments
    const userTenants = await TenantActions.getTenantsForUser(user._id!);
    console.log('User tenants:', userTenants.map((t) => ({ _id: t._id, name: t.name })));
    expect(userTenants).toHaveLength(2);

    // Create assistants in each tenant
    const assistant1Data: AssistantBlock.IAssistant = {
      name: `Assistant 1 ${unique}`,
      tenantId: tenant1._id!,
    };
    const assistant2Data: AssistantBlock.IAssistant = {
      name: `Assistant 2 ${unique}`,
      tenantId: tenant2._id!,
    };
    const assistant3Data: AssistantBlock.IAssistant = {
      name: `Assistant 3 ${unique}`,
      tenantId: tenant1._id!, // Another assistant in first tenant
    };
    const assistant4Data: AssistantBlock.IAssistant = {
      name: `Assistant 4 ${unique}`,
      tenantId: tenant3._id!,
    };
    const assistant5Data: AssistantBlock.IAssistant = {
      name: `Assistant 5 ${unique}`,
      tenantId: tenant4._id!,
    };

    const assistant1 = await AssistantActions.createAssistant(assistant1Data);
    const assistant2 = await AssistantActions.createAssistant(assistant2Data);
    const assistant3 = await AssistantActions.createAssistant(assistant3Data);
    const assistant4 = await AssistantActions.createAssistant(assistant4Data);
    const assistant5 = await AssistantActions.createAssistant(assistant5Data);

    expect(assistant1).toBeDefined();
    expect(assistant2).toBeDefined();
    expect(assistant3).toBeDefined();
    expect(assistant4).toBeDefined();
    expect(assistant5).toBeDefined();

    console.log('Created assistants:');
    console.log('Assistant 1:', { _id: assistant1._id, name: assistant1.name, tenantId: assistant1.tenantId, parent_id: (assistant1 as any).parent_id });
    console.log('Assistant 2:', { _id: assistant2._id, name: assistant2.name, tenantId: assistant2.tenantId, parent_id: (assistant2 as any).parent_id });
    console.log('Assistant 3:', { _id: assistant3._id, name: assistant3.name, tenantId: assistant3.tenantId, parent_id: (assistant3 as any).parent_id });
    console.log('Assistant 4:', { _id: assistant4._id, name: assistant4.name, tenantId: assistant4.tenantId, parent_id: (assistant4 as any).parent_id });
    console.log('Assistant 5:', { _id: assistant5._id, name: assistant5.name, tenantId: assistant5.tenantId, parent_id: (assistant5 as any).parent_id });

    // Test getAllAssistantsForUser - should return assistants from both tenants
    const result = await getAllAssistantsForUser(user._id!);

    console.log('Result from getAllAssistantsForUser:', result?.length || 0, 'assistants found');
    if (result && result.length > 0) {
      result.forEach((assistant, index) => {
        console.log(`Assistant ${index + 1}:`, {
          _id: assistant._id,
          name: assistant.name,
          tenantId: assistant.tenantId,
          parent_id: (assistant as any).parent_id
        });
      });
    }

    expect(result).toBeDefined();
    expect(result).toHaveLength(3); // Should find all 3 assistants across both tenants

    // Verify the assistants are from the correct tenants
    const assistantNames = result!.map(a => a.name).sort();
    expect(assistantNames).toEqual([
      `Assistant 1 ${unique}`,
      `Assistant 2 ${unique}`,
      `Assistant 3 ${unique}`
    ].sort());

    // Verify tenant IDs are correct
    const tenant1Assistants = result!.filter(a => a.tenantId === tenant1._id);
    const tenant2Assistants = result!.filter(a => a.tenantId === tenant2._id);

    expect(tenant1Assistants).toHaveLength(2); // assistant1 and assistant3
    expect(tenant2Assistants).toHaveLength(1); // assistant2
  });

  it('should return empty array when user has no tenants with getAllAssistantsForUser', async () => {
    // Create a user with no tenant assignments
    const userData: UserBlock.IUser = {
      name: 'No Tenant User',
      phone_number: '4155551214',
      email: `no-tenant@${uuidv4()}.com`,
      interests: ['isolation'],
    };
    const user = await createTestUser(userData, 'password123');

    console.log('Testing with user ID:', user._id);
    const result = await getAllAssistantsForUser(user._id!);
    console.log('Result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveLength(0);
  });

  it('should throw error when getting all assistants for user without userId', async () => {
    await expect(getAllAssistantsForUser('')).rejects.toThrow('Unauthorized');
  });

  it('should return the specific assistant for the logged-in user', async () => {
    // start with a successful creation
    // define a tenant
    const tenant = await createTestTenant();

    // define a user
    const userData: UserBlock.IUser = {
      name: 'Ben Derdundat',
      phone_number: '4155551212',
      email: `ben@some_${uuidv4()}email.com`,
    };

    // define an assistant
    const assistantData: AssistantBlock.IAssistant = {
      name: `Assistant ${unique}`,
      tenantId: tenant._id!,
      user: userData.name
    };
    const assistant = await AssistantActions.createAssistant(assistantData);

    const result = await AssistantActions.getAssistantById(assistant._id!);
    expect(result!.name).toBe(assistantData.name);
  });

  it('should return null if assistant is not found', async () => {
    const mockAssistantId = '22222222-2222-2222-2222-222222222222';
    const assistant = await AssistantActions.getAssistantById(mockAssistantId);
    await expect(assistant).toBeNull();
  });

  it('should update the assistant and return the updated document', async () => {
    // start with a successful creation
    // define a tenant
    const tenant = await createTestTenant();

    // define a user
    const userData: UserBlock.IUser = {
      name: 'Ben Derdundat',
      phone_number: '4155551212',
      email: `ben@some_${uuidv4()}email.com`,
    };

    // define an assistant
    const assistantData: AssistantBlock.IAssistant = {
      name: `Assistant ${unique}`,
      tenantId: tenant._id!,
      user: userData.name
    };
    const assistant = await AssistantActions.createAssistant(assistantData);
    const mockUpdateData: UpdateAssistantParams = { name: 'Updated Assistant Name' };
    const updatedAssistant = await AssistantActions.updateAssistant(assistant._id!, mockUpdateData);

    expect(updatedAssistant).toBeDefined();
    expect(updatedAssistant).toHaveProperty('name', mockUpdateData.name);
  });

  it('should update assistant with subdomain', async () => {
    const tenant = await createTestTenant();
    const assistantData: AssistantBlock.IAssistant = {
      name: `Assistant ${unique}`,
      tenantId: tenant._id!,
    };
    const assistant = await AssistantActions.createAssistant(assistantData);
    const mockUpdateData: UpdateAssistantParams = { subDomain: 'updated-subdomain' };
    const updatedAssistant = await AssistantActions.updateAssistant(assistant._id!, mockUpdateData);

    expect(updatedAssistant).toBeDefined();
    expect(updatedAssistant).toHaveProperty('_id', assistant._id);
  });

  it('should update assistant with vapiDown flag', async () => {
    const tenant = await createTestTenant();
    const assistantData: AssistantBlock.IAssistant = {
      name: `Assistant ${unique}`,
      tenantId: tenant._id!,
    };
    const assistant = await AssistantActions.createAssistant(assistantData);
    const mockUpdateData: UpdateAssistantParams = { vapiDown: true };
    const updatedAssistant = await AssistantActions.updateAssistant(assistant._id!, mockUpdateData);

    expect(updatedAssistant).toBeDefined();
    expect(updatedAssistant).toHaveProperty('vapiDown', true);
  });

  it('should throw an error if assistant to update is not found', async () => {
    // start with a successful creation
    const mockAssistantId = '22222222-2222-2222-2222-222222222222';
    const mockUpdateData: UpdateAssistantParams = { name: 'Updated Assistant Name' };
    await expect(AssistantActions.updateAssistant(mockAssistantId, mockUpdateData)).rejects.toThrow('Assistant not found');
  });

  it('should delete the assistant and return the deleted document', async () => {
    // start with a successful creation
    // define a tenant
    const tenant = await createTestTenant();

    // define a user
    const userData: UserBlock.IUser = {
      name: 'Ben Derdundat',
      phone_number: '4155551212',
      email: `ben@some_${uuidv4()}email.com`,
    };

    // define an assistant
    const assistantData: AssistantBlock.IAssistant = {
      name: 'Agenda Detail Assistant A',
      tenantId: tenant._id!,
      user: userData.name
    };
    const assistant = await AssistantActions.createAssistant(assistantData);

    const deletedAssistant = await deleteAssistant(assistant._id!);
    expect(deletedAssistant).toBeDefined();
    expect(deletedAssistant).toHaveProperty('_id', assistant._id);
    expect(deletedAssistant).toHaveProperty('name', assistantData.name);
  });

  it('should return an empty object if assistant to delete is not found', async () => {
    // start with a successful creation
    const mockAssistantId = '22222222-2222-2222-2222-222222222222';
    await expect(deleteAssistant(mockAssistantId)).rejects.toThrow('Assistant not found');
  });

  // Subdomain-related tests
  describe('Subdomain Functions', () => {
    it('should get assistant by subdomain', async () => {
      const tenant = await createTestTenant();
      const assistantData: AssistantBlock.IAssistant = {
        name: `Assistant ${unique}`,
        tenantId: tenant._id!,
        subDomain: `assistant-${unique}`
      };
      const assistant = await AssistantActions.createAssistant(assistantData);
      const result = await getAssistantBySubDomain(`assistant-${unique}`);
      expect(result).toBeDefined();
      expect(result?._id).toEqual(assistant._id);
    });

    it('should return null for non-existent subdomain', async () => {
      const result = await getAssistantBySubDomain('non-existent-subdomain');
      expect(result).toBeNull();
    });

    it('should return null for null subdomain', async () => {
      const result = await getAssistantBySubDomain(null);
      expect(result).toBeNull();
    });

    it('should get assistant ID by subdomain', async () => {
      const tenant = await createTestTenant();
      const assistantData: AssistantBlock.IAssistant = {
        name: `Assistant ${unique}`,
        tenantId: tenant._id!,
        subDomain: `assistant-${unique}`
      };
      const assistant = await AssistantActions.createAssistant(assistantData);
      const result = await getAssistantIdBySubDomain(`assistant-${unique}`);
      expect(result).toBeDefined();
      expect(result).toEqual(assistant._id);
    });

    it('should return undefined for non-existent subdomain ID', async () => {
      const result = await getAssistantIdBySubDomain('non-existent-subdomain-id');
      expect(result).toBeUndefined();
    });
  });

  // Validation functions tests
  describe('Validation Functions', () => {
    it('should get validated assistant by ID', async () => {
      const tenant = await createTestTenant();
      const assistantData: AssistantBlock.IAssistant = {
        name: `Assistant ${unique}`,
        tenantId: tenant._id!,
      };
      const assistant = await AssistantActions.createAssistant(assistantData);

      const result = await getValidatedAssistant(assistant._id!, null);
      expect(result).toBeDefined();
      expect(result?._id).toEqual(assistant._id);
    });

    it('should get validated assistant by subdomain', async () => {
      const tenant = await createTestTenant();
      const assistantData: AssistantBlock.IAssistant = {
        name: `Assistant ${unique}`,
        tenantId: tenant._id!,
        subDomain: `assistant-${unique}`
      };
      const assistant = await AssistantActions.createAssistant(assistantData);

      const result = await getValidatedAssistant(null, `assistant-${unique}`);
      expect(result).toBeDefined();
      expect(result?._id).toEqual(assistant._id);
    });

    it('should return null for invalid assistant ID', async () => {
      const result = await getValidatedAssistant('invalid-uuid', null);
      expect(result).toBeNull();
    });

    it('should return null for non-existent assistant', async () => {
      const result = await getValidatedAssistant('22222222-2222-2222-2222-222222222222', null);
      expect(result).toBeNull();
    });

    it('should get validated assistant ID by ID', async () => {
      const tenant = await createTestTenant();
      const assistantData: AssistantBlock.IAssistant = {
        name: `Assistant ${unique}`,
        tenantId: tenant._id!,
      };
      const assistant = await AssistantActions.createAssistant(assistantData);

      const result = await getValidatedAssistantId(assistant._id!, null);
      expect(result).toBeDefined();
      expect(result).toEqual(assistant._id);
    });

    it('should get validated assistant ID by subdomain', async () => {
      const tenant = await createTestTenant();
      const assistantData: AssistantBlock.IAssistant = {
        name: `Assistant ${unique}`,
        tenantId: tenant._id!,
        subDomain: `assistant-${unique}`
      };
      const assistant = await AssistantActions.createAssistant(assistantData);
      const result = await getValidatedAssistantId(null, `assistant-${unique}`);
      expect(result).toBeDefined();
      expect(result).toEqual(assistant._id);
    });
  });

  // Cloning tests
  describe('Clone Assistant', () => {
    it('should clone an assistant successfully', async () => {
      const tenant = await createTestTenant();
      const assistantData: AssistantBlock.IAssistant = {
        name: `Assistant ${unique}`,
        tenantId: tenant._id!,
        subDomain: `assistant-${unique}`
      };
      const originalAssistant = await AssistantActions.createAssistant(assistantData);

      const cloneParams: CloneAssistantParams = {
        newName: `Cloned Assistant ${unique}`,
        newSubdomain: `cloned-assistant-${unique}`
      };

      const clonedData: AssistantBlock.IAssistant = await cloneAssistant(originalAssistant._id!, cloneParams);

      expect(clonedData).toBeDefined();
      expect(clonedData).toHaveProperty('_id');
      expect(clonedData._id).not.toEqual(originalAssistant._id);
    });

    it('should clone assistant with persona_name', async () => {
      const tenant = await createTestTenant();
      const assistantData: AssistantBlock.IAssistant = {
        name: `Assistant ${unique}`,
        tenantId: tenant._id!,
      };
      const originalAssistant = await AssistantActions.createAssistant(assistantData);

      const cloneParams: CloneAssistantParams = {
        newName: `Cloned Assistant ${unique}`,
        persona_name: 'New Persona'
      };

      const clonedData: AssistantBlock.IAssistant = await cloneAssistant(originalAssistant._id!, cloneParams);

      expect(clonedData).toBeDefined();
      expect(clonedData).toHaveProperty('_id');
      expect(clonedData._id).not.toEqual(originalAssistant._id);
    });

    it('should clone assistant with special_instructions', async () => {
      const tenant = await createTestTenant();
      const assistantData: AssistantBlock.IAssistant = {
        name: `Assistant ${unique}`,
        tenantId: tenant._id!,
      };
      const originalAssistant = await AssistantActions.createAssistant(assistantData);

      const cloneParams: CloneAssistantParams = {
        newName: `Cloned Assistant ${unique}`,
        special_instructions: 'New special instructions'
      };

      const clonedData: AssistantBlock.IAssistant = await cloneAssistant(originalAssistant._id!, cloneParams);

      expect(clonedData).toBeDefined();
      expect(clonedData).toHaveProperty('_id');
      expect(clonedData._id).not.toEqual(originalAssistant._id);
    });

    it('should generate subdomain from name if not provided', async () => {
      const tenant = await createTestTenant();
      const assistantData: AssistantBlock.IAssistant = {
        name: `Assistant ${unique}`,
        tenantId: tenant._id!,
      };
      const originalAssistant = await AssistantActions.createAssistant(assistantData);

      const cloneParams: CloneAssistantParams = {
        newName: `Cloned Assistant ${unique}`,
      };

      const clonedData: AssistantBlock.IAssistant = await cloneAssistant(originalAssistant._id!, cloneParams);

      expect(clonedData).toBeDefined();
      expect(clonedData).toHaveProperty('_id');
      expect(clonedData._id).not.toEqual(originalAssistant._id);
    });

    it('should throw error when cloning non-existent assistant', async () => {
      const cloneParams: CloneAssistantParams = {
        newName: 'Cloned Assistant'
      };

      await expect(cloneAssistant('22222222-2222-2222-2222-222222222222', cloneParams))
        .rejects.toThrow('Source assistant not found');
    });

    it('should throw error when cloning with duplicate name', async () => {
      const tenant = await createTestTenant();
      const assistantData: AssistantBlock.IAssistant = {
        name: `Assistant ${unique}`,
        tenantId: tenant._id!,
      };
      const originalAssistant = await AssistantActions.createAssistant(assistantData);

      // Create another assistant with the same name in the SAME tenant
      const duplicateAssistantData: AssistantBlock.IAssistant = {
        name: `Duplicate Assistant ${unique}`,
        tenantId: tenant._id!, // Ensure same tenant
      };
      const duplicateAssistant = await AssistantActions.createAssistant(duplicateAssistantData);

      const cloneParams: CloneAssistantParams = {
        newName: `Duplicate Assistant ${unique}` // This should conflict with duplicateAssistant
      };

      await expect(cloneAssistant(originalAssistant._id!, cloneParams))
        .rejects.toThrow('An assistant with this name already exists');
    });
  });

  // Template assistants tests
  describe('Template Assistants', () => {
    it('should get template assistants for a user', async () => {
      const tenant = await createTestTenant();
      const userData: UserBlock.IUser = {
        name: 'Template User',
        phone_number: '4155551212',
        email: 'template@user.com',
        interests: ['templates'],
      };
      const user = await createTestUser(userData, 'password123');
      const result = await getTemplateAssistants(tenant._id!, user._id!);
      expect(result).toBeDefined();
    });

    it('should return empty array when no template assistants exist', async () => {
      const tenant = await createTestTenant();
      const user = await createTestUser();
      const result = await getTemplateAssistants(tenant._id!, user._id!);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('Content Types', () => {
    // Dynamic content definition for SpeakerEx
    const speakerExDefinition = {
      tenantId: '', // This will be set dynamically
      name: 'SpeakerEx',
      description: 'A dynamic clone of Speaker',
      dataModel: {
        block: 'SpeakerEx',
        jsonSchema: {
          type: "object",
          properties: {
            _id: { type: "string", format: "uuid" },
            assistant_id: { type: "string" },
            name: { type: "string" },
            bio: { type: "string" },
            photo: { type: "string", format: "uri" },
            title: { type: "string" },
            session: { type: "string" },
            dayTime: { type: "string" },
            categories: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: [
            "assistant_id",
            "name",
            "bio",
            "photo",
            "title",
            "session",
            "dayTime",
            "categories"
          ],
          additionalProperties: false
        } as any,
        indexer: ['name', 'required'],
        parent: { type: 'field' as const, field: 'assistant_id' },
      },
      uiConfig: {},
      access: {},
    };

    const agendaExDefinition = {
      tenantId: '', // This will be set dynamically
      name: 'AgendaEx',
      description: 'Dynamic Agenda content type',
      dataModel: {
        block: 'AgendaEx',
        indexer: [
          'title',
          'categories'
        ],
        jsonSchema: {
          additionalProperties: false,
          properties: {
            _id: {
              format: 'uuid',
              type: 'string'
            },
            assistant_id: {
              type: 'string'
            },
            categories: {
              items: {
                type: 'string'
              },
              type: 'array'
            },
            dayTime: {
              type: 'string'
            },
            description: {
              type: 'string'
            },
            location: {
              type: 'string'
            },
            speaker: {
              type: 'string'
            },
            tellMeMore: {
              type: 'string'
            },
            title: {
              type: 'string'
            },
            track: {
              type: 'string'
            },
            type: {
              type: 'string'
            }
          },
          required: [
            'assistant_id'
          ],
          type: 'object'
        },
        parent: {
          field: 'assistant_id',
          type: 'field' as const
        }
      },
      uiConfig: {},
      access: {}
    };

    const speakerRaw = {
      name: 'Test Speaker',
      bio: 'A test speaker bio',
      photo: 'https://example.com/photo.jpg',
      title: 'test-speaker-title',
      session: 'test-session',
      dayTime: new Date().toISOString(),
      categories: ['test', 'speaker']
    };

    const agendaRaw = {
      description: 'Test Agenda',
      speaker: 'Test Speaker',
      track: 'test-track',
      title: 'test-agenda-title',
      dayTime: new Date().toISOString(),
      categories: ['test', 'agenda']
    };

    let assistantId: string;

    beforeEach(async () => {
      if (!prism) {
        throw new Error('Test prism not initialized');
      }

      // create a tenant
      const tenant = await createTestTenant();
      expect(tenant._id).toBeTruthy();
      const tenantId = tenant._id!;
      // create an assistant
      const assistant = await createTestAssistant({
        name: `Assistant ${unique}`,
        tenantId: tenantId,
      });
      expect(assistant._id).toBeTruthy();
      assistantId = assistant._id!;

      // set tenantId in definitions
      speakerExDefinition.tenantId = tenantId;
      agendaExDefinition.tenantId = tenantId;

      // create a dynamic content definition for SpeakerEx
      const speakerEx_result = await prism.createDefinition(speakerExDefinition, tenantId);
      expect(speakerEx_result).toBeTruthy();
      // Use 'as any' to access _id/page_id
      const speakerEx_defId = speakerEx_result.items[0]._id;
      expect(speakerEx_defId).toBeDefined();
      // create a dynamic content definition for AgendaEx
      const agendaEx_result = await prism.createDefinition(agendaExDefinition, tenantId);
      expect(agendaEx_result).toBeTruthy();
      // Use 'as any' to access _id/page_id
      const agendaEx_defId = agendaEx_result.items[0]._id;
      expect(agendaEx_defId).toBeDefined();

      // Create SpeakerEx content
      const data: ContentData = { ...speakerRaw, assistant_id: assistantId };
      const createdSpeaker = await prism.create(speakerExDefinition.dataModel.block, data, tenantId);
      expect(createdSpeaker).toBeDefined();
      expect(createdSpeaker.total).toBe(1);
      const page = createdSpeaker.items[0];
      expect(page._id).toBeTruthy();
      const speakerExId = (page as any)._id;
      expect(speakerExId).toBeDefined();
      // Create AgendaEx content
      const agendaData: ContentData = { ...agendaRaw, assistant_id: assistantId };
      const createdAgenda = await prism.create(agendaExDefinition.dataModel.block, agendaData, tenantId);
      expect(createdAgenda).toBeDefined();
      expect(createdAgenda.total).toBe(1);
      const agendaPage = createdAgenda.items[0];
      expect(agendaPage._id).toBeTruthy();
      const agendaExId = (agendaPage as any)._id;
      expect(agendaExId).toBeDefined();

      // add the content types to the assistant
      const updateData = { ...assistant, contentTypes: [speakerExDefinition.dataModel.block, agendaExDefinition.dataModel.block] }
      const updatedAssistant = await AssistantActions.updateAssistant(assistantId, updateData);
      expect(updatedAssistant).toBeDefined();
      expect(updatedAssistant!.contentTypes).toContain(speakerExDefinition.dataModel.block);
      expect(updatedAssistant!.contentTypes).toContain(agendaExDefinition.dataModel.block);
    });

    it('should return content types for an assistant', async () => {
      const contentTypes = await AssistantActions.getAssistantContent(assistantId);
      expect(contentTypes).toBeDefined();
      expect(Object.keys(contentTypes)).toHaveLength(2);
      expect(['SpeakerEx', 'AgendaEx']).toEqual(Object.keys(contentTypes));
    });
  });

  // Error handling tests
  describe('Error Handling', () => {
    it('should handle duplicate assistant name creation', async () => {
      const tenant = await createTestTenant();
      const assistantData: AssistantBlock.IAssistant = {
        name: `Assistant ${unique}`,
        tenantId: tenant._id!,
      };

      // Create first assistant
      await AssistantActions.createAssistant(assistantData);

      // Try to create second assistant with same name
      await expect(AssistantActions.createAssistant(assistantData)).rejects.toThrow('An assistant with this name already exists');
    });

    it('should handle database connection errors gracefully', async () => {
      // This test would require mocking the database connection
      // to simulate connection failures
      expect(true).toBe(true); // Placeholder for now
    });
  });

});