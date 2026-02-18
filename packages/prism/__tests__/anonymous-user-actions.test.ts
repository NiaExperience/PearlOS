import { v4 as uuidv4 } from 'uuid';

import {
    createAnonymousUser,
    deleteAnonymousUser,
    migrateAnonymousUserData
} from '../src/core/actions/anonymous-user-actions';
import { AnonymousUserBlock } from '../src/core/blocks';
import { PrismContentQuery } from '../src/core/types';
import { Prism } from '../src/prism';

describe('Anonymous User Actions', () => {
    let prism: Prism;
    beforeEach(async () => {
        prism = await Prism.getInstance();
        expect(prism).not.toBeNull();
        expect(prism).not.toBeNull();
        if (!prism) {
            throw new Error('Test Prism instance is not initialized');
        }
    });

    afterAll(async () => {
        if (prism) {
            await prism.disconnect();
        }
    });

    describe('createAnonymousUser', () => {
        it('should create a new anonymous user with a generated session ID', async () => {
            const anonymousUser = await createAnonymousUser();
            expect(anonymousUser).toBeDefined();
            expect(anonymousUser.sessionId).toBeDefined();
            expect(anonymousUser.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        });
    });

    describe('deleteAnonymousUser', () => {
        it('should find and delete an anonymous user by session ID', async () => {
            const anonymousUser = await createAnonymousUser();
            expect(anonymousUser).toBeDefined();
            expect(anonymousUser.sessionId).toBeDefined();

            await deleteAnonymousUser(anonymousUser.sessionId);

            const query: PrismContentQuery = {
                contentType: AnonymousUserBlock.BlockType,
                tenantId: 'any',
                where: { page_id: anonymousUser._id }
            };
            const result = await prism.query(query);
            expect(result.items.length).toBe(0);
        });

        it('should return null when user is not found', async () => {
            await expect(deleteAnonymousUser(uuidv4())).resolves.toBeNull();
        });
    });

    describe('migrateAnonymousUserData', () => {
        it('should extract message store data from anonymous user', async () => {
            const mockSessionId = uuidv4();
            const mockAnonymousUser: AnonymousUserBlock.IAnonymousUser = {
                sessionId: mockSessionId,
                messages: [{ content: 'msg1', timestamp: new Date().toISOString(), type: 'text' }],
                chatHistory: [{ message: 'chat1', timestamp: new Date().toISOString(), sender: 'Bob' }],
                eventHistory: [{ eventType: 'evt1', timestamp: new Date().toISOString() }]
            };
            const created = await prism.create(
                AnonymousUserBlock.BlockType, 
                mockAnonymousUser, 
                'any'
            );
            expect(created.total).toBe(1);
            expect(created.items.length).toBe(1);

            const result = await migrateAnonymousUserData(mockSessionId);

            // Verify message store data is extracted
            expect(result).toEqual({
                messages: mockAnonymousUser.messages,
                chatHistory: mockAnonymousUser.chatHistory,
                eventHistory: mockAnonymousUser.eventHistory,
            });
        });

        it('should handle missing message data with empty arrays', async () => {
            const mockAnonymousUser: AnonymousUserBlock.IAnonymousUser = {
                sessionId: uuidv4(),
                // No message arrays defined
            };
            const created = await prism.create(
                AnonymousUserBlock.BlockType, 
                mockAnonymousUser, 
                'any'
            );
            expect(created).toBeDefined();
            expect(created.total).toBe(1);
            const anonymousUser = created.items[0];
            expect(anonymousUser).toBeDefined();
            expect(anonymousUser.sessionId).toBe(mockAnonymousUser.sessionId);
            expect(anonymousUser.messages).toBeUndefined();
            expect(anonymousUser.chatHistory).toBeUndefined();
            expect(anonymousUser.eventHistory).toBeUndefined();

            const result = await migrateAnonymousUserData(mockAnonymousUser.sessionId);

            expect(result).toEqual({
                messages: [],
                chatHistory: [],
                eventHistory: [],
            });
        });

        it('should throw error when user is not found', async () => {
            await expect(migrateAnonymousUserData(uuidv4())).rejects.toThrow('Anonymous user not found');
        });
    });
});
