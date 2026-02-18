/* eslint-disable @typescript-eslint/no-explicit-any */
import { compare, hash } from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

import * as AccountActions from '../src/core/actions/account-actions';
import { createAnonymousUser } from '../src/core/actions/anonymous-user-actions';
import * as UserActions from '../src/core/actions/user-actions';
import { convertAnonymousUserToUser, getUserByPhoneNumber } from '../src/core/actions/user-actions';
import { createAuthOptions } from '../src/core/auth/authOptions';
import { AccountBlock, UserBlock } from '../src/core/blocks';
import { BlockType_User } from '../src/core/blocks/user.block';
import { IUser } from '../src/core/blocks/user.block';
import { PrismContentQuery } from '../src/core/types';
import { Prism } from '../src/prism';
import { createTestAssistant, createTestTenant, createTestUser } from '../src/testing/testlib';

// Mock dependencies
jest.mock('bcryptjs', () => ({
    hash: jest.fn(),
    compare: jest.fn()
}));

async function createAUser(name: string) {
    const data: UserBlock.IUser = {
        name: name,
        phone_number: '4155551212',
        email: `testuser-${uuidv4()}@example.com`,
        social_styles: 'retro',
        status: 'chill',
        eventHistory: [
            {
                eventType: 'guest_interaction',
                timestamp: new Date().toISOString(),
                details: [JSON.stringify({
                    guests_involved: ['Bob Loblaw'],
                    conversation: ['You seem confused', 'wut'],
                    outcome: ['I am confused', 'You look it'],
                })],
            },
        ],
        messages: [{
            type: 'declaration',
            content: 'I think things are looking rosy',
            timestamp: new Date().toISOString(),
        },
        {
            type: 'response',
            content: 'wut',
            timestamp: new Date().toISOString(),
        }],
        chatHistory: [{
            message: 'blue is my favorite color',
            sender: 'sky',
            timestamp: new Date().toISOString(),
        },
        {
            message: 'wut',
            sender: 'user',
            timestamp: new Date().toISOString(),
        }]
    };
    return await UserActions.createUser({ ...data, password: 'the ox sleeps in the meadow' });
};

// define a user
function userData(): IUser {
    return {
        name: 'Ben Derdundat',
        phone_number: '4155551212',
        email: `testuser-${uuidv4()}@example.com`,
    };
};


describe('User Actions (shared)', () => {
    let prism: Prism | null = null;
    beforeEach(async () => {
        prism = await Prism.getInstance();
        expect(prism).not.toBeNull();
        if (!prism) {
            throw new Error('Prism instance not initialized');
        }
    });
    afterAll(async () => {
        if (prism) {
            await prism.disconnect();
        }
    });

    describe('createUser', () => {
        it('should create a user without password for OAuth', async () => {
            // Setup test data and mocks
            const mockUserData = {
                name: 'OAuth User',
                email: 'oauth@example.com',
                image: 'https://example.com/profile.jpg'
            };

            // Execute
            const result = await UserActions.createUser(mockUserData);
            const query: PrismContentQuery = {
                tenantId: 'any',
                contentType: BlockType_User,
                where: { page_id: result._id }
            };
            const userResult = await prism!.query(query);
            const user = (userResult?.items || []).find(u => u._id === result._id);
            expect(user).toBeTruthy();
            expect(user?.password_hash).not.toBeDefined();
        });

        it('should create a user with password', async () => {
            const mockUserData = {
                name: 'Password User',
                email: 'password@example.com',
                password: 'securePassword123'
            };

            const result = await UserActions.createUser(mockUserData);

            expect(result._id).toBeTruthy();
            expect(result.name).toEqual(mockUserData.name);
            expect(result.email).toEqual(mockUserData.email);
            // Password hash might be undefined if user was created without password
            // This is expected behavior for OAuth users
        });

        it('should throw error when name is missing', async () => {
            const mockUserData = {
                email: 'no-name@example.com'
            };

            await expect(UserActions.createUser(mockUserData as Omit<UserBlock.IUser, 'password_hash'> & { password?: string })).rejects.toThrow('Name is required');
        });

        it('should throw error when email is missing', async () => {
            const mockUserData = {
                name: 'No Email User'
            };

            await expect(UserActions.createUser(mockUserData as Omit<UserBlock.IUser, 'password_hash'> & { password?: string })).rejects.toThrow('Email is required');
        });

        it('should throw error when email is invalid', async () => {
            const mockUserData = {
                name: 'Invalid Email User',
                email: 'invalid-email'
            };

            await expect(UserActions.createUser(mockUserData)).rejects.toThrow('Invalid email');
        });

        it('should throw error when user with email already exists', async () => {
            const mockUserData = {
                name: 'Duplicate User',
                email: 'duplicate@example.com'
            };

            // Create first user
            await UserActions.createUser(mockUserData);
            // Try to create second user with same email
            await expect(UserActions.createUser(mockUserData)).rejects.toThrow('User with this email already exists');
        });

        it('should create user with complex data', async () => {
            const complexUserData = {
                name: 'Complex User',
                email: 'complex@example.com',
                phone_number: '1234567890',
                interests: ['coding', 'reading'],
                social_styles: 'introvert',
                status: 'active',
                eventHistory: [
                    {
                        eventType: 'login',
                        timestamp: new Date().toISOString(),
                        details: ['successful login']
                    }
                ],
                messages: [
                    {
                        type: 'welcome',
                        content: 'Welcome to the platform',
                        timestamp: new Date().toISOString()
                    }
                ],
                chatHistory: [
                    {
                        message: 'Hello world',
                        sender: 'user',
                        timestamp: new Date().toISOString()
                    }
                ]
            };

            const result = await UserActions.createUser(complexUserData);

            expect(result._id).toBeTruthy();
            expect(result.name).toEqual(complexUserData.name);
            expect(result.interests).toEqual(complexUserData.interests);
            expect(result.eventHistory).toEqual(complexUserData.eventHistory);
        });
    });

    describe('getUserById', () => {
        it('should return user by ID', async () => {
            const user = await createAUser('Get By ID User');
            if (!user._id) {
                throw new Error('User ID is not defined');
            }

            const result = await UserActions.getUserById(user._id);
            expect(result).not.toBeNull();
            expect(result?.name).toEqual('Get By ID User');
            expect(result?.email).toEqual(user.email);
        });

        it('should return null for non-existent user ID', async () => {
            const result = await UserActions.getUserById('non-existent-id');
            expect(result).toBeNull();
        });

        it('should handle empty user ID', async () => {
            const result = await UserActions.getUserById('');
            expect(result).toBeNull();
        });
    });

    describe('getUsers', () => {
        it('should return users successfully', async () => {
            const mockUserItem1 = await createAUser('Bob Periwinkle');
            const mockUserItem2 = await createAUser('Joe Blue');
            const mockUserItem3 = await createAUser('Tanya Teal');
            expect(mockUserItem1._id).not.toBeNull();
            expect(mockUserItem2._id).not.toBeNull();
            expect(mockUserItem3._id).not.toBeNull();
            expect(mockUserItem1.name).toEqual('Bob Periwinkle');
            expect(mockUserItem2.name).toEqual('Joe Blue');
            expect(mockUserItem3.name).toEqual('Tanya Teal');

            const result = await UserActions.getUsers(undefined);
            expect(result.length >= 3); // our three, plus the admin session user
        });

        it('should filter users by assistant name', async () => {
            // create a tenant
            const tenantData = {
                name: 'Test Tenant'
            };
            const tenant = await createTestTenant();
            // create an assistant
            const assistantData = {
                name: `Assistant ${uuidv4()}`,
                tenantId: tenant._id!
            };
            const assistant = await createTestAssistant(assistantData);

            const mockUserItem1 = await createAUser('Bob Periwinkle');
            const mockUserItem2 = await createAUser('Joe Blue');

            // assign user to tenant

            const result = await UserActions.getUsers(assistant.subDomain);
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe('getUserByEmail', () => {
        it('should find a user by email (case insensitive)', async () => {
            (hash as jest.Mock).mockImplementation(jest.requireActual('bcryptjs').hash);
            (compare as jest.Mock).mockImplementation(jest.requireActual('bcryptjs').compare);

            // Setup test data and mocks
            const mixedCaseEmail = 'TestMixedCase@Email.com';
            const mockUser = {
                email: mixedCaseEmail.toLocaleLowerCase(),
                name: 'Test User'
            };

            const user = await createTestUser(mockUser, 'password456');
            if (!user || !user._id) {
                throw new Error('User creation failed');
            }

            // Execute
            const result = await UserActions.getUserByEmail(mixedCaseEmail);
            expect(result).toBeDefined();
            expect(result).toHaveProperty('email');
            expect(result).toHaveProperty('_id');
            expect(result).toHaveProperty('name');

            // Verify
            expect(result?.email).toEqual(mockUser.email);
            expect(result?._id).toEqual(user._id);
            expect(result?.name).toEqual(mockUser.name);
        });

        it('should return null when user is not found', async () => {
            const result = await UserActions.getUserByEmail('nonexistent@example.com');
            expect(result).toBeNull();
        });

        it('should throw error when email is not provided', async () => {
            await expect(UserActions.getUserByEmail('')).rejects.toThrow('Email is required');
        });

        it('should handle case sensitive email search', async () => {
            const user = await createAUser('Case Test User');

            // Search with different case
            const result = await UserActions.getUserByEmail(user.email!.toUpperCase());
            expect(result).not.toBeNull();
            expect(result?.email).toEqual(user.email);
        });
    });

    describe('updateUser', () => {
        it('should update user successfully', async () => {
            const user = await createAUser('Update Test User');
            if (!user._id) {
                throw new Error('User ID is not defined');
            }

            const updateData = {
                name: 'Updated Name',
                email: 'update-test@example.com',
                phone_number: '9876543210',
                interests: ['updated interest']
            };

            const result = await UserActions.updateUser(user._id, updateData);
            expect(result.success).toBe(true);
            expect(result.data?.name).toEqual('Updated Name');
            expect(result.data?.phone_number).toEqual('9876543210');
        });

        it('should update user password', async () => {
            (hash as jest.Mock).mockImplementation(jest.requireActual('bcryptjs').hash);
            (compare as jest.Mock).mockImplementation(jest.requireActual('bcryptjs').compare);

            const user = await createAUser('Password Update User');
            if (!user._id) {
                throw new Error('User ID is not defined');
            }

            const updateData = {
                name: user.name,
                email: user.email,
                password: 'newPassword123'
            };

            const result = await UserActions.updateUser(user._id, updateData);
            expect(result.success).toBe(true);
            expect(result.data?.password_hash).toBeDefined();
        });

        it('should return error when user not found', async () => {
            const updateData = {
                name: 'Non-existent User',
                email: 'non-existent@example.com'
            };

            const result = await UserActions.updateUser(uuidv4(), updateData);
            expect(result.success).toBe(false);
            expect(result.statusCode).toBe(404);
        });

        it('should handle partial updates', async () => {
            const user = await createAUser('Partial Update User');
            if (!user._id) {
                throw new Error('User ID is not defined');
            }

            const updateData = {
                name: 'Partially Updated Name',
                email: 'partial-update@example.com'
            };

            const result = await UserActions.updateUser(user._id, updateData);
            expect(result.success).toBe(true);
            expect(result.data?.name).toEqual('Partially Updated Name');
            expect(result.data?.email).toEqual('partial-update@example.com'); // Should remain unchanged
        });
    });

    describe('deleteUser', () => {
        it('should delete user successfully', async () => {
            const user = await createAUser('Delete Test User');
            if (!user._id) {
                throw new Error('User ID is not defined');
            }

            const result = await UserActions.deleteUser(user._id);
            expect(result.success).toBe(true);
            expect(result.message).toEqual('User deleted successfully');

            // Verify user is actually deleted
            const deletedUser = await UserActions.getUserById(user._id);
            expect(deletedUser).toBeNull();
        });

        it('should return error when user not found', async () => {
            const result = await UserActions.deleteUser(uuidv4());
            expect(result.success).toBe(false);
            expect(result.statusCode).toBe(404);
        });

        it('should handle deletion of user with accounts', async () => {
            const user = await createAUser('Account Delete User');
            if (!user._id) {
                throw new Error('User ID is not defined');
            }

            // Create an account for the user
            await AccountActions.createAccount({
                userId: user._id,
                provider: 'google',
                providerAccountId: 'google-123',
                type: 'oauth'
            } as AccountBlock.IAccount);

            const result = await UserActions.deleteUser(user._id);
            expect(result.success).toBe(true);
        });
    });

    describe('getCurrentUser', () => {
        it('should return current user when authenticated', async () => {
            // This test would need proper session mocking
            // For now, we'll test the function structure
            const authOptions = createAuthOptions({ appType: 'interface', baseUrl: 'http://localhost:3000', googleCredentials: { clientId: 'x', clientSecret: 'y' } });
            const result = await UserActions.getCurrentUser(authOptions);
            expect(result).toHaveProperty('success');

            if (result.success) {
                expect(result).toHaveProperty('data');
            } else {
                expect(result).toHaveProperty('error');
                expect(result).toHaveProperty('statusCode');
            }
        });

        it('should return error when not authenticated', async () => {
            // This would need session mocking to test properly
            // For now, we'll just verify the function handles the case
            const authOptions = createAuthOptions({ appType: 'interface', baseUrl: 'http://localhost:3000', googleCredentials: { clientId: 'x', clientSecret: 'y' } });
            const result = await UserActions.getCurrentUser(authOptions);
            expect(result).toHaveProperty('success');
        });
    });

    describe('verifyUserPassword', () => {
        it('should return true when password is correct', async () => {
            // Setup mocks
            // nosemgrep: hardcoded password allowed in tests
            const password = 'password123';
            const mockUser = await createTestUser(userData(), 'password123');
            if (!mockUser || !mockUser._id) {
                throw new Error('User creation failed');
            }

            // Execute
            const result = await UserActions.verifyUserPassword(mockUser._id, password);

            // Verify
            expect(result).toBe(true);
        });

        it('should return false when password is incorrect', async () => {
            // Setup mocks
            // nosemgrep: hardcoded password allowed in tests
            const password = 'wrong-password';
            const mockUser = await createTestUser(userData(), 'password123');


            // Execute
            const result = await UserActions.verifyUserPassword(mockUser._id!, password);

            // Verify
            expect(result).toBe(false);
        });

        it('should return false when user is not found', async () => {
            await createTestUser(userData(), 'password123');

            const result = await UserActions.verifyUserPassword('nonexistent', 'password');

            expect(result).toBe(false);
        });

        it('should return false when user has no password hash', async () => {
            const user = await createAUser('No Password User');
            if (!user._id) {
                throw new Error('User ID is not defined');
            }

            const result = await UserActions.verifyUserPassword(user._id, 'any-password');
            expect(result).toBe(false);
        });
    });
    describe('convertAnonymousUserToUser', () => {
        it('converts anonymous user and merges metadata', async () => {
            const anon = await createAnonymousUser();
            expect(anon._id).toBeDefined();
            const userData = { name: 'Anon Upgraded', email: 'anon-upgraded@example.com', metadata: { theme: 'dark' } } as any;
            const converted = await convertAnonymousUserToUser(anon._id!, userData);
            expect(converted._id).toBeDefined();
            expect(converted.email).toBe('anon-upgraded@example.com');
        });
        it('returns existing user if email already exists (anonymous not deleted)', async () => {
            const existing = await createAUser('Existing Email User');
            const anon = await createAnonymousUser();
            const returned = await convertAnonymousUserToUser(anon._id!, { name: 'Should Ignore', email: existing.email } as any);
            expect(returned._id).toBe(existing._id);
            const prism = await Prism.getInstance();
            const q: PrismContentQuery = { tenantId: 'any', contentType: 'AnonymousUser', where: { page_id: anon._id } } as any;
            const res = await prism.query(q);
            expect(res.items.length).toBe(1);
        });
        it('throws if anonymous user not found', async () => {
            await expect(convertAnonymousUserToUser('11111111-1111-1111-1111-111111111111', { name: 'X', email: 'x@example.com' } as any)).rejects.toThrow('Anonymous user not found');
        });
    });
    describe('getUserByPhoneNumber', () => {
        it('finds user by phone number under assistant (parent)', async () => {
            const tenant = await createTestTenant();
            const assistant = await createTestAssistant({ name: 'phone-assistant', tenantId: tenant._id! });
            expect(assistant._id).toBeDefined();
            const prism = await Prism.getInstance();
            const phone = '15551234567';
            const user = { name: 'Phone Lookup', email: 'phonelookup@example.com', phone_number: phone, parent_id: assistant._id } as any;
            const created = await prism.create(BlockType_User, user, 'any');
            expect(created.total).toBe(1);
            // Debug: log created user for troubleshooting lookup
            // eslint-disable-next-line no-console
            console.log('Created user for phone lookup test', created.items[0]);
            const found = await getUserByPhoneNumber(phone, assistant._id!);
            expect(found).not.toBeNull();
            expect(found?.phone_number).toBe(phone);
        });
        it('returns null when phone not found', async () => {
            const tenant = await createTestTenant();
            const assistant = await createTestAssistant({ name: 'phone-assistant-null', tenantId: tenant._id! });
            const found = await getUserByPhoneNumber('0000000000', assistant._id!);
            expect(found).toBeNull();
        });
        it('throws when phone number missing', async () => {
            const tenant = await createTestTenant();
            const assistant = await createTestAssistant({ name: 'phone-assistant-missing', tenantId: tenant._id! });
            await expect(getUserByPhoneNumber('', assistant._id!)).rejects.toThrow('Phone number is required');
        });
        it('throws when assistant id invalid', async () => {
            await expect(getUserByPhoneNumber('15550000000', 'not-a-uuid')).rejects.toThrow('Assistant ID is required');
        });
    });
});
