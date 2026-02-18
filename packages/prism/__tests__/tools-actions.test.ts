import { v4 as uuidv4 } from 'uuid';
import { createTenant } from '../src/core/actions/tenant-actions';
import * as ToolsActions from '../src/core/actions/tools-actions';
import { ToolType, ToolBaseType, MessageType, MessageRole } from '../src/core/blocks/tool.block';
import { testSessionUser } from '../src/testing/testlib';
import { createAuthOptions } from '../src/core/auth/authOptions';


describe('Tools Actions', () => {
  let tenant;
  // Use a test config object for createAuthOptions
  let authOptions = createAuthOptions({
      appType: 'interface',
      baseUrl: 'http://localhost:3000',
      googleCredentials: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret'
      }
  });
  beforeEach(async () => {
    expect(testSessionUser).not.toBeNull();
    tenant = await createTenant({ name: `Test Tenant ${uuidv4()}` });
    if (!tenant || !tenant._id) {
      throw new Error('Tenant creation failed');
    }
  });

  describe('createTool', () => {
    it('should create a new tool', async () => {
      const toolData = {
        name: 'Test Tool',
        description: 'A test tool for testing',
        type: ToolType.FUNCTION,
        baseType: ToolBaseType.PHOTOS,
        async: false,
        userId: testSessionUser!._id!,
        function: {
          name: 'testFunction',
          description: 'A test function',
          parameters: {
            type: 'object',
            properties: {
              testParam: {
                type: 'string',
                description: 'A test parameter'
              }
            },
            required: ['testParam']
          }
        }
      };

      const tool = await ToolsActions.createTool(toolData, authOptions);

      expect(tool).toBeDefined();
      expect(tool._id).toBeDefined();
      expect(tool.type).toBe(ToolType.FUNCTION);
      expect(tool.baseType).toBe(ToolBaseType.PHOTOS);
      expect(tool.async).toBe(false);
      expect(tool.userId).toBeDefined();
      expect(tool.function?.name).toBe('testFunction');
      expect(tool.function?.description).toBe('A test function');
    });

    it('should create a tool with messages', async () => {
      const toolData = {
        name: 'Test Tool with Messages',
        description: 'A test tool with messages',
        type: ToolType.FUNCTION,
        userId: testSessionUser!._id!,
        requestMessages: {
          start: {
            type: MessageType.TEXT,
            content: 'Starting tool execution',
            role: MessageRole.ASSISTANT
          },
          completed: {
            type: MessageType.TEXT,
            content: 'Tool execution completed',
            role: MessageRole.ASSISTANT
          }
        }
      };

      const tool = await ToolsActions.createTool(toolData, authOptions);

      expect(tool).toBeDefined();
      expect(tool.requestMessages?.start?.content).toBe('Starting tool execution');
      expect(tool.requestMessages?.start?.role).toBe(MessageRole.ASSISTANT);
      expect(tool.requestMessages?.completed?.content).toBe('Tool execution completed');
    });

    it('should create a tool with server configuration', async () => {
      const toolData = {
        name: 'Test Tool with Server',
        description: 'A test tool with server config',
        type: ToolType.FUNCTION,
        userId: testSessionUser!._id!,
        server: {
          url: 'https://api.example.com',
          timeoutSeconds: '30',
          secret: 'test-secret',
          headers: {
            'Authorization': 'Bearer token',
            'Content-Type': 'application/json'
          }
        }
      };

      const tool = await ToolsActions.createTool(toolData, authOptions);

      expect(tool).toBeDefined();
      expect(tool.server?.url).toBe('https://api.example.com');
      expect(tool.server?.timeoutSeconds).toBe('30');
      expect(tool.server?.secret).toBe('test-secret');
      expect(tool.server?.headers?.['Authorization']).toBe('Bearer token');
    });
  });

  describe('getAllTools', () => {
    it('should return all tools for authenticated user', async () => {
      // Create multiple tools
      const toolData1 = {
        name: 'Tool 1',
        description: 'First tool',
        type: ToolType.FUNCTION,
        userId: testSessionUser!._id!
      };

      const toolData2 = {
        name: 'Tool 2',
        description: 'Second tool',
        type: ToolType.OUTPUT,
        userId: testSessionUser!._id!
      };

      await ToolsActions.createTool(toolData1, authOptions);
      await ToolsActions.createTool(toolData2, authOptions);

      const tools = await ToolsActions.getAllTools(testSessionUser!._id!);

      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThanOrEqual(2);
      console.log(tools);
      
      const toolNames = tools.map(tool => tool.name);
      expect(toolNames).toContain('Tool 1');
      expect(toolNames).toContain('Tool 2');
    });
  });

  describe('getToolsForUser', () => {
    it('should return tools for specific user', async () => {
      const userId = testSessionUser!._id!;
      const toolData = {
        name: 'User Tool',
        description: 'A tool for specific user',
        type: ToolType.FUNCTION,
        userId: userId
      };

      await ToolsActions.createTool(toolData, authOptions);

      // Get the admin session user ID
      const tools = await ToolsActions.getToolsForUser(userId);

      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      
      const tool = tools.find(t => t.name === 'User Tool');
      expect(tool).toBeDefined();
      expect(tool?.userId).toBe(userId);
    });
  });

  describe('getToolById', () => {
    it('should return tool by ID', async () => {
      const toolData = {
        name: 'Tool to Find',
        description: 'A tool to find by ID',
        type: ToolType.FUNCTION,
        userId: testSessionUser!._id!
      };

      const createdTool = await ToolsActions.createTool(toolData, authOptions);
      const foundTool = await ToolsActions.getToolById(createdTool._id!, authOptions);

      expect(foundTool).toBeDefined();
      expect(foundTool?._id).toBe(createdTool._id);
      expect(foundTool?.name).toBe('Tool to Find');
    });

    it('should return null for non-existent tool', async () => {
      const foundTool = await ToolsActions.getToolById('non-existent-id', authOptions);
      expect(foundTool).toBeNull();
    });
  });

  describe('updateTool', () => {
    it('should update tool successfully', async () => {
      const toolData = {
        name: 'Original Tool',
        description: 'Original description',
        type: ToolType.FUNCTION,
        userId: testSessionUser!._id!
      };

      const createdTool = await ToolsActions.createTool(toolData, authOptions);

      const updateData = { 
        ...toolData,
        name: 'Updated Tool',
        description: 'Updated description'
      };

      const updatedTool = await ToolsActions.updateTool(createdTool._id!, tenant._id!, updateData, authOptions);

      expect(updatedTool).toBeDefined();
      expect(updatedTool.name).toBe('Updated Tool');
      expect(updatedTool.description).toBe('Updated description');
      expect(updatedTool.type).toBe(ToolType.FUNCTION); // Should preserve original type
    });

    it('should throw error when tool not found', async () => {
      const updateData = {
        name: 'Updated Tool',
        description: 'Updated description',
        userId: testSessionUser!._id!
      };

      await expect(ToolsActions.updateTool(uuidv4(), tenant._id!, updateData, authOptions)).rejects.toThrow('Tool not found');
    });
  });

  describe('deleteTool', () => {
    it('should delete tool successfully', async () => {
      const tenant = await createTenant({name:`Test Tenant ${uuidv4()}`});
      if (!tenant || !tenant._id) {
        throw new Error('Tenant creation failed');
      }
      const toolData = {
        name: 'Tool to Delete',
        description: 'A tool to delete',
        type: ToolType.FUNCTION,
        userId: testSessionUser!._id!
      };

      const createdTool = await ToolsActions.createTool(toolData, authOptions);

      const result = await ToolsActions.deleteTool(createdTool._id!, tenant._id!, authOptions);

      expect(result).toBe(true);
      // Verify tool is deleted
      const foundTool = await ToolsActions.getToolById(createdTool._id!, authOptions);
      expect(foundTool).toBeNull();
    });

    it('should throw error when tool not found', async () => {
      await expect(ToolsActions.deleteTool(uuidv4(), tenant._id!, authOptions)).rejects.toThrow('Tool not found');
    });
  });

  describe('getAllToolsForGivenIds', () => {
    it('should return tools for given IDs', async () => {
      const toolData1 = {
        name: 'Tool 1',
        description: 'First tool',
        type: ToolType.FUNCTION,
        userId: testSessionUser!._id!
      };

      const toolData2 = {
        name: 'Tool 2',
        description: 'Second tool',
        type: ToolType.OUTPUT,
        userId: testSessionUser!._id!
      };

      const tool1 = await ToolsActions.createTool(toolData1, authOptions);
      const tool2 = await ToolsActions.createTool(toolData2, authOptions);

      const tools = await ToolsActions.getAllToolsForGivenIds([tool1._id!, tool2._id!], tenant._id!);

      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBe(2);
      
      const toolNames = tools.map(tool => tool.name);
      expect(toolNames).toContain('Tool 1');
      expect(toolNames).toContain('Tool 2');
    });

    it('should handle non-existent tool IDs gracefully', async () => {
      const toolData = {
        name: 'Existing Tool',
        description: 'An existing tool',
        type: ToolType.FUNCTION,
        userId: testSessionUser!._id!
      };

      const tool = await ToolsActions.createTool(toolData, authOptions);

      const tools = await ToolsActions.getAllToolsForGivenIds([tool._id!, 'non-existent-id'], tenant._id!);

      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBe(1); // Only the existing tool should be returned
      expect(tools[0].name).toBe('Existing Tool');
    });
  });
}); 