/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';

import * as fs from 'fs';
import * as path from 'path';

import MongoMenuItemModel from '../apps/dashboard/src/migration/models/menu.model';
import connectDB from '../apps/interface/src/migration/config/connect-DB';
import MongoAssistantModel from '../apps/interface/src/migration/models/assistant.model';
import MongoDishModel from '../apps/interface/src/migration/models/dish.model';

const ARCHIVE_DIR = path.join('/tmp', 'migration-archive');

const assistantMap: Record<string, string> = {};
async function listAssistants() {
    //list all of the assistants and their _id's
    await connectDB();
    const assistants = await (MongoAssistantModel as any).find(
        {},
        { _id: 1, subDomain: 1 }
    ).lean();

    if (assistants.length === 0) {
        console.log('No assistants found.');
        return;
    }
    // Sort assistants by subDomain
    assistants.sort((a: { subDomain: string }, b: { subDomain: string }) => a.subDomain.localeCompare(b.subDomain));
    console.log('Assistants with specified subDomains:');
    assistants.forEach((assistant: { _id: string; subDomain: string }) => {
        assistantMap[assistant._id] = assistant.subDomain;
        console.log(`- ID: ${assistant._id}, SubDomain: ${assistant.subDomain}`);
    });
}

async function archiveDishesAndMenus() {
    await connectDB();
    if (!fs.existsSync(ARCHIVE_DIR)) {
        fs.mkdirSync(ARCHIVE_DIR);
    }
    const dishes = await MongoDishModel.find({});
    const menuItems = await MongoMenuItemModel.find({});

    //for each dish, look up the assistant_id in the assistantMap and log the <subDomain, dishName>
    if (dishes.length === 0) {
        console.log('No dishes found.');
    } else {
        console.log('Dishes found:');
        dishes.forEach((dish: { _id: string; assistant_id: string; item_name: string }) => {
            const subDomain = assistantMap[dish.assistant_id];
            if (subDomain) {
                console.log(`- Item Name: ${dish.item_name}, Assistant: ${subDomain},`);
            }
        });
    }

    if (menuItems.length === 0) {
        console.log('No menu items found.');
    } else {
        console.log('Menu items found:');
        menuItems.forEach((item: { _id: string; assistant_id: string; item_name: string }) => {
            const subDomain = assistantMap[item.assistant_id];
            if (subDomain) {
                console.log(`- Item Name: ${item.item_name}, Assistant: ${subDomain}`);
            }
        });
    }
}

async function main() {
    await listAssistants();
    await archiveDishesAndMenus();
}

main().catch((err) => {
    console.error('Error archiving mongo data:', err);
    process.exit(1);
}); 