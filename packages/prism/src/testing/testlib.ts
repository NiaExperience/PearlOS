/**
 * @jest-environment node
 */
import { v4 as uuidv4 } from 'uuid';

import {
  IAccount,
  IAssistant,
  IAssistantFeedback,
  ITenant,
  TenantPlanTier,
  ITool,
  IUser
} from './types';

// Import ContentActions
import { createAccount } from '../core/actions/account-actions';
import { createAnonymousUser } from '../core/actions/anonymous-user-actions';
import { createAssistant } from '../core/actions/assistant-actions';
import { createAssistantFeedback } from '../core/actions/assistant-feedback-actions';
import { createOrganization } from '../core/actions/organization-actions';
import { createTenant } from '../core/actions/tenant-actions';
import { createTool } from '../core/actions/tools-actions';
import { createUser } from '../core/actions/user-actions';
import { ContentData } from '../core/content/types';

// Check if Jest is available to avoid errors in non-Jest environments
if (typeof jest !== 'undefined') {
  // Mock the auth middleware module
  jest.mock('../core/auth', () => {
    const actual = jest.requireActual('../core/auth');
    return {
      requireAuth: jest.fn().mockResolvedValue(null),
      requireTenantAdmin: jest.fn().mockResolvedValue(null),
      requireTenantAccess: jest.fn().mockResolvedValue(null),
      getSessionSafely: actual.getSessionSafely
    };
  });

  // Mock next-auth
  jest.mock('next-auth', () => ({
    __esModule: true,
    default: jest.fn(() => ({ GET: jest.fn(), POST: jest.fn() }))
  }));

  // Mock the getServerSession
  jest.mock('next-auth', async () => ({
    getServerSession: jest.fn().mockResolvedValue({
      user: {
        id: '00000000-0000-0000-0000-000000000000',
        name: 'Admin Session User',
        email: 'admin@niaxp.com'
      }
    })
  }), { virtual: true });
}

export let testSessionUser: IUser = {
  name: 'Admin Session User',
  email: 'admin@niaxp.com',
  _id: '00000000-0000-0000-0000-000000000000'
};

// Declare global testSessionUser for TypeScript
declare global {
  var testSessionUser: IUser | null;
}


function makeRandomUser(): IUser {
  return {
    name: `Test User ${uuidv4()}`,
    email: `testuser-${uuidv4()}@example.com`,
  };
}

/**
 * Creates a test user with the provided data
 * @param userData - The user data to create
 * @param password - The password for the user
 * @returns The created user data
 */
export async function createTestUser(userData: IUser = makeRandomUser(), password: string = 'password123'): Promise<IUser> {
  return await createUser({
    ...userData,
    password
  });
}

/**
 * Creates a test tenant with default data
 * @returns The created tenant data
 */
export async function createTestTenant(overrides: ContentData = {}): Promise<ITenant> {
  const tenantData: ITenant = {
    name: `Test Tenant ${uuidv4()}`,
    // Default to a unique domain per invocation to avoid uniqueness constraints in tests
    domain: `test-tenant-${uuidv4()}.example.com`,
    settings: {
      theme: 'default',
      features: ['feature1', 'feature2']
    },
    planTier: TenantPlanTier.FREE
  };

  const finalData = { ...tenantData, ...overrides };
  return await createTenant(finalData);
}

/**
 * Creates a test assistant with the provided data
 * @param assistantData - The assistant data to create
 * @returns The created assistant data
 */
export async function createTestAssistant(assistantData: IAssistant): Promise<IAssistant> {
  const name = assistantData.name || `Test Assistant ${uuidv4()}`;
  const createData = { ...assistantData, name, subDomain: name.toLowerCase().replace(/\s+/g, '-') };
  console.log('Creating test assistant with data:', createData);
  return await createAssistant(createData);
}

/**
 * Creates a test tool with the provided data
 * @param toolData - The tool data to create
 * @returns The created tool data
 */
export async function createTestTool(toolData: ITool): Promise<ITool> {
  return await createTool(toolData);
}

/**
 * Creates a test anonymous user
 * @returns The created anonymous user data
 */
export async function createTestAnonymousUser(): Promise<any> {
  try {
    // Use ContentActions instead of direct notion-service
    const anonymousUser = await createAnonymousUser();
    return anonymousUser;
  } catch (error) {
    console.error('Error creating test anonymous user:', error);
    throw error;
  }
}

/**
 * Creates a test organization with the provided data
 * @param organizationData - The organization data to create
 * @returns The created organization data
 */
export async function createTestOrganization(organizationData: any): Promise<any> {
  try {
    // Use ContentActions instead of direct notion-service
    const organization = await createOrganization(organizationData);
    return organization;
  } catch (error) {
    console.error('Error creating test organization:', error);
    throw error;
  }
}

export async function createTestAccount(overrides: ContentData): Promise<IAccount> {
  return await createAccount(overrides as unknown as IAccount);
}

export async function createTestAssistantFeedback(overrides: ContentData): Promise<IAssistantFeedback> {
  const feedbackData: IAssistantFeedback = {
    assistant_id: '00000000-0000-0000-0000-000000000000',
    call_id: uuidv4(),
    description: 'Test feedback description',
    ...overrides
  };

  return await createAssistantFeedback(feedbackData as unknown as IAssistantFeedback);
}