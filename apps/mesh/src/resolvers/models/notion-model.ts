/* eslint-disable @typescript-eslint/no-explicit-any */
import { DataTypes, Model, ModelAttributes, ModelOptions, Sequelize } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

/**
 * Interface representing the NotionModel data structure
 */
export interface INotionModel {
    id?: number; // Auto-incrementing primary key from database
    block_id: string;
    page_id: string;
    parent_id?: string;
    type: string;
    content: string;
    indexer: Record<string, any>;
    order?: number;
    version?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface NotionModelCreationAttributes extends Omit<INotionModel, 'id' | 'block_id'> { }

/**
 * NotionModel schema definition for Sequelize
 */
export const notionModelAttributes: ModelAttributes = {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    block_id: {
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: () => uuidv4(),
        unique: true
    },
    page_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    parent_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    type: {
        type: DataTypes.STRING,
        allowNull: false
    },
    content: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    indexer: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    order: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    version: {
        type: DataTypes.STRING,
        allowNull: true
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
    }
};

/**
 * NotionModel options for Sequelize
 */
export const notionModelOptions: ModelOptions = {
    tableName: 'notion_blocks',
    timestamps: true,
    indexes: [
        {
            name: 'idx_notion_blocks_page_type',
            fields: ['page_id', 'type']
        },
        {
            name: 'idx_notion_blocks_parent_type',
            fields: ['parent_id', 'type']
        },
        {
            name: 'idx_notion_blocks_page_order',
            fields: ['page_id', 'order']
        },
    ]
};

/**
 * NotionModel class extending Sequelize Model
 */
export class NotionModel extends Model<INotionModel, NotionModelCreationAttributes> {
    declare id?: number;
    declare block_id: string;
    declare page_id: string;
    declare parent_id?: string;
    declare type: string;
    declare content: string;
    declare indexer: Record<string, any>;
    declare order?: number;
    declare version?: string;
    declare createdAt: Date;
    declare updatedAt: Date;

    /**
     * Initialize the NotionModel with a Sequelize instance
     */
    static initModel(sequelize: Sequelize): typeof NotionModel {
        NotionModel.init(notionModelAttributes, {
            ...notionModelOptions,
            sequelize
        });
        return NotionModel;
    }
}

/**
 * NotionModel with timestamps - used for API responses
 */
export type NotionBlockWithTimestamps = INotionModel & {
  createdAt: string | Date;
  updatedAt: string | Date;
};

/**
 * Interface wrapper to contain a notion "page",
 * simply all the blocks with the same page_id
 */
export interface NotionPage<T> {
  page_id: string;
  blocks: NotionBlockWithTimestamps[];
  data: T;
}

/**
 * Create and return a configured NotionModel
 * This is the recommended way to get the NotionModel for use in other modules
 */
export function createNotionModel(sequelize: Sequelize): typeof NotionModel {
  return NotionModel.initModel(sequelize);
}
