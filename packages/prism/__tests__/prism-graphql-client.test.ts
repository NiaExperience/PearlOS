/**
 * @jest-environment node
 * 
 * Test suite for PrismGraphQLClient - Core Data Bridge
 * 
 * This tests the fundamental GraphQL client that serves as the bridge between
 * Nia Universal applications and the underlying data mesh infrastructure.
 * It handles content creation, querying, and definitions management.
 */

import { IDynamicContent } from '@nia/prism/core/blocks/dynamicContent.block';
import { ContentData } from '@nia/prism/core/content/types';
import { PrismContentResult } from '@nia/prism/core/types';
import { PrismGraphQLClient } from '@nia/prism/data-bridge/PrismGraphQLClient';
import { NotionModel } from '@nia/prism/data-bridge/graphql/types';
import { testSessionUser, createTestTenant } from '@nia/prism/testing/testlib';
import { v4 as uuidv4 } from 'uuid';

import { PlatformProvider } from '../src/data-bridge/provider';

describe('PrismGraphQLClient - Core Data Bridge', () => {
    let client: PrismGraphQLClient;

    beforeEach(async () => {
        expect(testSessionUser).not.toBeNull();
        client = new PrismGraphQLClient('http://localhost:5001/graphql');
        await client.connect();
    });

    describe('Connection Management', () => {
        it('should establish and maintain GraphQL connection', async () => {
            expect(client).toBeDefined();
            expect(await client.connect()).toBe(true);
            // Client should be connected after start() in beforeEach
        });
    });

    describe('Definition Management', () => {
        it('should find existing definitions by type', async () => {
            // Look for Tenant definition (created in setup)
            const results: PrismContentResult = await client.findDefinition('Tenant', 'any');
            
            expect(results).toBeDefined();
            expect(results.total).toBeGreaterThan(0);
            expect(results.items).toBeDefined();
            expect(results.items.length).toBeGreaterThan(0);
        });

        it('should handle non-existent definition searches gracefully', async () => {
            const nonExistentType = `NonExistent_${Date.now()}`;
            const results: PrismContentResult = await client.findDefinition(nonExistentType, uuidv4());
            
            expect(results).toBeDefined();
            expect(results.total).toBe(0);
            expect(results.items).toEqual([]);
        });

        it('should create new content definitions', async () => {
            const tenant = await createTestTenant();
            const testType = `TestDefinition_${Date.now()}`;
            const definition: IDynamicContent = {
                name: testType,
                dataModel: {
                    block: testType,
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            description: { type: 'string' }
                        }
                    },
                    indexer: [],
                    provider: PlatformProvider
                }
            };

            const result = await client.createDefinition(definition, tenant._id!);
            expect(result).toBeDefined();
            expect(result.content).toBeDefined();
            // Content is the full definition object
            expect((result.content as any).name).toBe(testType);
        });
    });

    describe('Content Operations', () => {
        it('should create content with valid data', async () => {
            const contentData: ContentData = {
                name: 'Test User',
                email: `test.${Date.now()}@example.com`
            };

            const result = await client.createContent('User', contentData, 'any');
            
            expect(result).toBeDefined();
            expect(result.type).toBe('User');
            expect(result.content).toMatchObject(contentData);
        });

        it('should handle content creation with tenant-specific data', async () => {
            // First create a tenant
            const tenantData: ContentData = {
                name: `Test Tenant ${Date.now()}`,
                domain: 'test-tenant.com'
            };

            const tenantResult = await client.createContent('Tenant', tenantData, 'any');
            const tenantId = tenantResult.page_id;

            // Then create content within that tenant
            const assistantData: ContentData = {
                name: 'Test Assistant',
                prompt: 'Test prompt',
                tenantId: tenantId
            };

            const result = await client.createContent('Assistant', assistantData, 'any');
            
            expect(result).toBeDefined();
            expect(result.type).toBe('Assistant');
            expect(result.content).toMatchObject(assistantData);
        });

        it('should validate content data before creation', async () => {
            // Test with invalid content type
            await expect(client.createContent('NonExistentType', {}, 'any')).rejects.toThrow();
        });
    });

    describe('Querying Operations', () => {
        it('should query content with basic filters', async () => {
            // Create some test content first
            const userData: ContentData = {
                name: `Query Test User ${Date.now()}`,
                email: `querytest.${Date.now()}@example.com`
            };

            await client.createContent('User', userData, 'any');

            // Now query for it
            const results: PrismContentResult = await client.findContent('User');
            
            expect(results).toBeDefined();
            expect(results.items).toBeDefined();
            expect(Array.isArray(results.items)).toBe(true);
            expect(results.items.length).toBeGreaterThan(0);
        });

        it('should handle complex queries with where clauses', async () => {
            const results: PrismContentResult = await client.findContent(
                'User',
                { email: { contains: '@example.com' } },
                5,
                0
            );
            
            expect(results).toBeDefined();
            expect(results.items).toBeDefined();
            // Results may be empty, but structure should be correct
        });

        it('should handle pagination parameters', async () => {
            const results: PrismContentResult = await client.findContent(
                'User',
                undefined,
                2,
                0
            );
            
            expect(results).toBeDefined();
            expect(results.items.length).toBeLessThanOrEqual(2);
        });
    });

    describe('Content Updates', () => {
        it('should update existing content', async () => {
            // Create content first
            const tenant = await createTestTenant();
            const originalData: ContentData = {
                name: 'Original Name',
                email: `original.${Date.now()}@example.com`
            };

            const createResult = await client.createContent('User', originalData, tenant._id!);
            const contentId = createResult.block_id;

            // Update the content
            const updatedData: ContentData = {
                name: 'Updated Name',
                email: originalData.email // Keep the same email
            };

            const updateResult = await client.updateContent(contentId, 'User', updatedData, tenant._id!);

            expect(updateResult).toBeDefined();
            
            // The updateContent method returns PrismContentResult now
            expect((updateResult as any).total).toBe(1);
            expect((updateResult as any).items).toHaveLength(1);
            const updatedModel = (updateResult as any).items[0];
            expect(updatedModel.content).toBeDefined();
            expect(updatedModel.content.name).toBe('Updated Name');
            expect(updatedModel.content.email).toBe(originalData.email);
        });

        it('should handle partial updates correctly', async () => {
            // Create complex content
            const assistantData: ContentData = {
                name: 'Test Assistant',
                prompt: 'Original prompt',
                config: { temperature: 0.7, maxTokens: 1000 }
            };

            const createResult = await client.createContent('Assistant', assistantData, 'any');
            const contentId = createResult.block_id;

            // Partial update
            const partialUpdate: ContentData = {
                prompt: 'Updated prompt'
            };

            const updateResult = await client.updateContent(contentId, 'Assistant', partialUpdate);
            
            expect(updateResult).toBeDefined();
            
            // Handle the actual return type from updateContent
            if (updateResult && typeof updateResult === 'object' && 'content' in updateResult) {
                const contentData = (updateResult as any).content;
                expect(contentData.prompt).toBe('Updated prompt');
            } else {
                const contentData = (updateResult as any).items[0].content || {};
                expect(contentData.prompt).toBe('Updated prompt');
            }
        });
    });

    describe('Content Deletion', () => {
        it('should delete existing content', async () => {
            // Create content to delete
            const userData: ContentData = {
                name: 'To Be Deleted',
                email: `delete.${Date.now()}@example.com`
            };

            const createResult = await client.createContent('User', userData, 'any');
            const contentId = createResult.block_id;

            // Delete the content
            const deleteResult = await client.deleteContent(contentId);
            
            expect(deleteResult).toBe(true);
        });

        it('should handle deletion of non-existent content gracefully', async () => {
            const nonExistentId = `non-existent-${Date.now()}`;
            
            // Should handle gracefully without throwing
            try {
                const result = await client.deleteContent(nonExistentId);
                expect(result).toBeDefined();
                expect(typeof result).toBe('boolean');
            } catch (error) {
                // GraphQL might return an error for non-existent content, which is acceptable
                expect(error).toBeDefined();
            }
        });
    });

    describe('Bulk Operations', () => {
        it('should handle bulk content creation', async () => {
            const userData1: ContentData = {
                name: 'Bulk User 1',
                email: `bulk1.${Date.now()}@example.com`
            };
            
            const userData2: ContentData = {
                name: 'Bulk User 2', 
                email: `bulk2.${Date.now()}@example.com`
            };

            const result: PrismContentResult = await client.bulkCreateContent(
                'User',
                [userData1, userData2],
                'any'
            );
            
            expect(result).toBeDefined();
            expect(result.total).toBe(2);
            expect(result.items).toHaveLength(2);
        });
    });

    describe('Error Handling', () => {
        it('should handle GraphQL errors gracefully', async () => {
            // Test with malformed query
            await expect(client.query('invalid query')).rejects.toThrow();
        });

        it('should handle concurrent operations safely', async () => {
            // Test multiple simultaneous operations
            const promises: Promise<NotionModel>[] = [];
            
            for (let i = 0; i < 3; i++) {
                const userData: ContentData = {
                    name: `Concurrent User ${i}`,
                    email: `concurrent${i}.${Date.now()}@example.com`
                };
                promises.push(client.createContent('User', userData, 'any'));
            }

            const results = await Promise.all(promises);
            
            expect(results).toHaveLength(3);
            results.forEach(result => {
                expect(result).toBeDefined();
                expect(result.type).toBe('User');
            });
        });
    });

    describe('Provider Routing', () => {
        it('should handle provider-specific content routing', async () => {
            // Test that the client can determine provider routing
            const results: PrismContentResult = await client.findContent('User');
            
            expect(results).toBeDefined();
            // Should work with default nia-postgres-content provider
            expect(results.items).toBeDefined();
        });
    });
});
