// ============================================================================
// VERSION CONTROL MIGRATION SCRIPT
// ============================================================================
// This script adds version control fields to existing items in the database
// Run with: node scripts/addVersionControl.js

import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';
import logger from '../config/logger.js';

// Connect to MongoDB
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/notask');
        logger.info(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        logger.error('Database connection failed:', error);
        process.exit(1);
    }
};

/**
 * Recursively add version field to all items in a tree
 * @param {Array} items - Array of tree items
 * @returns {Array} Updated items with version fields
 */
const addVersionToItems = (items) => {
    if (!Array.isArray(items)) return items;
    
    return items.map(item => {
        const updatedItem = { ...item };
        
        // Add version field if it doesn't exist
        if (!updatedItem.version || typeof updatedItem.version !== 'number') {
            updatedItem.version = 1;
            logger.debug(`Added version field to item: ${updatedItem.id || updatedItem.label}`);
        }
        
        // Recursively handle children
        if (updatedItem.children && Array.isArray(updatedItem.children)) {
            updatedItem.children = addVersionToItems(updatedItem.children);
        }
        
        return updatedItem;
    });
};

/**
 * Migration function to add version control to all users
 */
const migrateVersionControl = async () => {
    try {
        logger.info('🚀 Starting version control migration...');
        
        // Get all users
        const users = await User.find({});
        logger.info(`Found ${users.length} users to migrate`);
        
        let migratedUsers = 0;
        let migratedItems = 0;
        
        for (const user of users) {
            let userModified = false;
            let userItemCount = 0;
            
            if (user.notesTree && Array.isArray(user.notesTree)) {
                const originalTree = user.notesTree;
                const updatedTree = addVersionToItems(originalTree);
                
                // Check if anything changed
                if (JSON.stringify(originalTree) !== JSON.stringify(updatedTree)) {
                    user.notesTree = updatedTree;
                    user.markModified('notesTree');
                    userModified = true;
                    
                    // Count items recursively
                    const countItems = (items) => {
                        let count = 0;
                        for (const item of items) {
                            count++;
                            if (item.children && Array.isArray(item.children)) {
                                count += countItems(item.children);
                            }
                        }
                        return count;
                    };
                    
                    userItemCount = countItems(updatedTree);
                    migratedItems += userItemCount;
                }
            }
            
            if (userModified) {
                await user.save();
                migratedUsers++;
                logger.info(`✅ Migrated user ${user.email || user._id} - ${userItemCount} items updated`);
            } else {
                logger.debug(`⏭️ User ${user.email || user._id} already has version control`);
            }
        }
        
        logger.info('🎉 Migration completed successfully!');
        logger.info(`📊 Migration Summary:`);
        logger.info(`   - Users processed: ${users.length}`);
        logger.info(`   - Users migrated: ${migratedUsers}`);
        logger.info(`   - Items migrated: ${migratedItems}`);
        
    } catch (error) {
        logger.error('❌ Migration failed:', error);
        throw error;
    }
};

/**
 * Rollback function to remove version control (for testing)
 */
const rollbackVersionControl = async () => {
    try {
        logger.info('🔄 Starting version control rollback...');
        
        const users = await User.find({});
        let rolledBackUsers = 0;
        
        for (const user of users) {
            let userModified = false;
            
            if (user.notesTree && Array.isArray(user.notesTree)) {
                const removeVersionFromItems = (items) => {
                    return items.map(item => {
                        const updatedItem = { ...item };
                        
                        // Remove version field
                        if (updatedItem.version !== undefined) {
                            delete updatedItem.version;
                            userModified = true;
                        }
                        
                        // Recursively handle children
                        if (updatedItem.children && Array.isArray(updatedItem.children)) {
                            updatedItem.children = removeVersionFromItems(updatedItem.children);
                        }
                        
                        return updatedItem;
                    });
                };
                
                user.notesTree = removeVersionFromItems(user.notesTree);
                
                if (userModified) {
                    user.markModified('notesTree');
                    await user.save();
                    rolledBackUsers++;
                    logger.info(`✅ Rolled back user ${user.email || user._id}`);
                }
            }
        }
        
        logger.info(`🎉 Rollback completed! ${rolledBackUsers} users processed`);
        
    } catch (error) {
        logger.error('❌ Rollback failed:', error);
        throw error;
    }
};

/**
 * Main execution function
 */
const main = async () => {
    try {
        await connectDB();
        
        const command = process.argv[2];
        
        switch (command) {
            case 'migrate':
            case undefined: // Default action
                await migrateVersionControl();
                break;
                
            case 'rollback':
                await rollbackVersionControl();
                break;
                
            case 'dry-run':
                logger.info('🔍 Starting dry run...');
                // Implement dry run logic here if needed
                const users = await User.find({});
                let itemsToMigrate = 0;
                
                for (const user of users) {
                    if (user.notesTree && Array.isArray(user.notesTree)) {
                        const countItemsWithoutVersion = (items) => {
                            let count = 0;
                            for (const item of items) {
                                if (!item.version) count++;
                                if (item.children && Array.isArray(item.children)) {
                                    count += countItemsWithoutVersion(item.children);
                                }
                            }
                            return count;
                        };
                        
                        itemsToMigrate += countItemsWithoutVersion(user.notesTree);
                    }
                }
                
                logger.info(`📊 Dry Run Results:`);
                logger.info(`   - Users to process: ${users.length}`);
                logger.info(`   - Items needing migration: ${itemsToMigrate}`);
                break;
                
            default:
                logger.info('Usage: node scripts/addVersionControl.js [migrate|rollback|dry-run]');
                logger.info('  migrate  : Add version control to all items (default)');
                logger.info('  rollback : Remove version control from all items');
                logger.info('  dry-run  : Show what would be migrated without making changes');
                break;
        }
        
    } catch (error) {
        logger.error('Script execution failed:', error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        logger.info('Database connection closed');
        process.exit(0);
    }
};

// Run the script
main();