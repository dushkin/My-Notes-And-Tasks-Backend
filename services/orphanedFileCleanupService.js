const fs = require('fs').promises;
const path = require('path');
const User = require('../models/User'); // Adjust path if your User model is elsewhere

// Define the directory where images are uploaded.
// This path MUST match where multer in imageRoutes.js saves files.
// Assuming 'services' directory is at the same level as 'public', 'routes', 'models'
// If server.js is at root, and services is ./services, and public is ./public
// then path.join(__dirname, '..', 'public', 'uploads', 'images') is correct.
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'images');

// Helper function to recursively extract all HTML content strings from a notesTree
function getAllContentStringsRecursive(items) {
    let contents = [];
    if (!Array.isArray(items)) {
        return contents;
    }

    for (const item of items) {
        if (item && (item.type === 'note' || item.type === 'task') && typeof item.content === 'string') {
            contents.push(item.content);
        }
        if (item && item.type === 'folder' && Array.isArray(item.children) && item.children.length > 0) {
            contents = contents.concat(getAllContentStringsRecursive(item.children));
        }
    }
    return contents;
}

// Helper function to extract image filenames from a single HTML content string
function extractImageFilenamesFromHtml(htmlContent) {
    if (!htmlContent || typeof htmlContent !== 'string') {
        return [];
    }
    const filenames = new Set();
    // Regex to find <img ... src=".../uploads/images/FILENAME.EXT" ... >
    // It captures the FILENAME.EXT part. It handles absolute or relative paths to /uploads/images/
    const imgRegex = /<img[^>]+src=["'](?:[^"']+\/)?uploads\/images\/([^"'\s?#]+)[^"']*["']/gi;
    let match;
    while ((match = imgRegex.exec(htmlContent)) !== null) {
        if (match[1]) {
            filenames.add(path.basename(match[1]));
        }
    }
    return Array.from(filenames);
}

async function cleanupOrphanedImages() {
    console.log(`[${new Date().toISOString()}] Starting orphaned image cleanup job...`);
    try {
        const users = await User.find({}, 'notesTree').lean(); // Use .lean() for performance with large datasets
        if (!users || users.length === 0) {
            console.log(`[${new Date().toISOString()}] No users found. Cleanup job exiting.`);
            return;
        }

        const activeImageFilenames = new Set();

        for (const user of users) {
            if (user.notesTree) {
                const allHtmlContents = getAllContentStringsRecursive(user.notesTree);
                for (const html of allHtmlContents) {
                    const filenamesInHtml = extractImageFilenamesFromHtml(html);
                    filenamesInHtml.forEach(filename => activeImageFilenames.add(filename));
                }
            }
        }
        console.log(`[${new Date().toISOString()}] Found ${activeImageFilenames.size} unique image filenames referenced in notes.`);

        let filesInUploadDir;
        try {
            filesInUploadDir = await fs.readdir(UPLOAD_DIR);
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.log(`[${new Date().toISOString()}] Upload directory ${UPLOAD_DIR} does not exist. Nothing to clean.`);
                return;
            }
            throw err;
        }

        console.log(`[${new Date().toISOString()}] Found ${filesInUploadDir.length} files in the upload directory: ${UPLOAD_DIR}`);

        let deletedCount = 0;
        let failedToDeleteCount = 0;

        for (const filename of filesInUploadDir) {
            // Skip .gitkeep or other meta-files if you have them
            if (filename === '.gitkeep') {
                continue;
            }
            if (!activeImageFilenames.has(filename)) {
                try {
                    const filePath = path.join(UPLOAD_DIR, filename);
                    await fs.unlink(filePath);
                    console.log(`[${new Date().toISOString()}] Deleted orphaned image: ${filename}`);
                    deletedCount++;
                } catch (err) {
                    failedToDeleteCount++;
                    console.error(`[${new Date().toISOString()}] Error deleting orphaned file ${filename}:`, err.message);
                }
            }
        }

        console.log(`[${new Date().toISOString()}] Orphaned image cleanup job finished. Deleted ${deletedCount} files. Failed to delete ${failedToDeleteCount} files.`);

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Critical error during orphaned image cleanup job:`, error);
    }
}

module.exports = { cleanupOrphanedImages };