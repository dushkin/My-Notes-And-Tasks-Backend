#!/usr/bin/env node

/**
 * Data Migration Script: Fix Corrupted Content
 * 
 * This script fixes content that was corrupted by the previous contentSanitizer bug
 * that double-encoded HTML entities (e.g., converting > to &gt;).
 * 
 * Usage: node scripts/fixCorruptedContent.js [--dry-run]
 */

import mongoose from 'mongoose';
import User from '../models/User.js';
import { sanitizeContent } from '../utils/contentSanitizer.js';
import logger from '../config/logger.js';

const isDryRun = process.argv.includes('--dry-run');

// Decode HTML entities to recover corrupted content
const decodeHtmlEntities = (str) => {
  if (!str || typeof str !== 'string') return str;
  
  if (str.includes('&lt;') || str.includes('&gt;') || str.includes('&amp;')) {
    const decoded = str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    return decoded;
  }
  
  return str;
};

// Check if content appears to be corrupted
const isCorruptedContent = (content) => {
  if (!content || typeof content !== 'string') return false;
  
  // Look for patterns like <tag&gt; which indicate corruption
  return /&gt;/.test(content) && /<[^>]*&gt;/.test(content);
};

// Recursively fix corrupted content in tree items
const fixCorruptedContentInTree = (items) => {
  if (!Array.isArray(items)) return items;
  
  let fixedCount = 0;
  
  const processItems = (itemsArray) => {
    return itemsArray.map(item => {
      if (!item) return item;
      
      let updatedItem = { ...item };
      
      // Fix content if corrupted
      if (item.content && isCorruptedContent(item.content)) {
        const originalContent = item.content;
        const decodedContent = decodeHtmlEntities(item.content);
        const sanitizedContent = sanitizeContent(decodedContent);
        
        if (sanitizedContent !== originalContent) {
          updatedItem.content = sanitizedContent;
          updatedItem.updatedAt = new Date().toISOString();
          fixedCount++;
          
          console.log(`🔧 Fixed corrupted content for item ${item.id}:`);
          console.log(`   Original: ${originalContent.substring(0, 100)}...`);
          console.log(`   Fixed:    ${sanitizedContent.substring(0, 100)}...`);
        }
      }
      
      // Recursively process children
      if (item.children && Array.isArray(item.children)) {
        const processedChildren = processItems(item.children);
        if (processedChildren !== item.children) {
          updatedItem.children = processedChildren;
        }
      }
      
      return updatedItem;
    });
  };
  
  const result = processItems(items);
  return { items: result, fixedCount };
};

const fixCorruptedContent = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/notask');
    logger.info('Connected to MongoDB for corrupted content fix');

    // Find all users with notes trees
    const users = await User.find({ 
      isVerified: true,
      notesTree: { $exists: true, $ne: [] } 
    });

    logger.info(`Found ${users.length} users to check for corrupted content`);

    let totalUsersFixed = 0;
    let totalItemsFixed = 0;

    for (const user of users) {
      try {
        const originalTree = user.notesTree || [];
        const { items: fixedTree, fixedCount } = fixCorruptedContentInTree(originalTree);
        
        if (fixedCount > 0) {
          totalUsersFixed++;
          totalItemsFixed += fixedCount;
          
          if (!isDryRun) {
            user.notesTree = fixedTree;
            user.markModified('notesTree');
            await user.save();
            
            logger.info(`✅ Fixed ${fixedCount} items for user ${user.email}`);
          } else {
            logger.info(`[DRY RUN] Would fix ${fixedCount} items for user ${user.email}`);
          }
        }
      } catch (userError) {
        logger.error(`Error processing user ${user.email}:`, userError);
      }
    }

    if (!isDryRun) {
      logger.info(`🎉 Migration completed! Fixed ${totalItemsFixed} items across ${totalUsersFixed} users`);
    } else {
      logger.info(`[DRY RUN] Would fix ${totalItemsFixed} items across ${totalUsersFixed} users`);
    }

  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
};

// Run the migration
if (isDryRun) {
  console.log('🔍 Running in DRY RUN mode - no changes will be made');
}

fixCorruptedContent()
  .then(() => {
    console.log('Migration process completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });