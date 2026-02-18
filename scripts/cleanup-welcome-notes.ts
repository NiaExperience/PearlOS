import { Prism } from '@nia/prism';

async function main() {
    console.log('Starting cleanup of "A Note from Pearl" notes...');
    const prism = await Prism.getInstance();
    
    const contentType = 'Notes';
    console.log(`Content Type: ${contentType}`);

    let totalDeleted = 0;
    let hasMore = true;

    while (hasMore) {
        console.log('Querying for notes...');
        const result = await prism.query({
            contentType,
            where: {
                indexer: { path: 'title', equals: 'A Note from Pearl' }
            },
            limit: 100,
            tenantId: 'any'
        });

        console.log(`Found ${result.items.length} notes to delete.`);

        if (result.items.length === 0) {
            hasMore = false;
            break;
        }

        for (const item of result.items) {
            try {
                // item._id is the page_id
                if (!item._id) {
                    console.warn('Item has no _id:', item);
                    continue;
                }
                
                // We pass 'any' as tenantId to ensure we can find it regardless of tenant context
                await prism.delete(contentType, item._id, 'any');
                console.log(`Deleted note ${item._id}`);
                totalDeleted++;
            } catch (e) {
                console.error(`Failed to delete note ${item._id}:`, e);
            }
        }
        
        // Add a small delay to avoid hammering the DB if it's fast
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`Cleanup complete. Deleted ${totalDeleted} notes.`);
}

main().catch(console.error);
