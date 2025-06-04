// services/orphanedFileCleanupService.js
import fs from 'fs/promises'; // Assuming ESM, changed to promises API
import path from 'path'; // Assuming ESM
import User from '../models/User.js'; // Assuming ESM and path to User model
import logger from '../config/logger.js'; // Import logger
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'images');

function getAllContentStringsRecursive(items) {
    let contents = [];
    if (!Array.isArray(items)) return contents;
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

function extractImageFilenamesFromHtml(htmlContent) {
    if (!htmlContent || typeof htmlContent !== 'string') return [];
    const filenames = new Set();
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
    const jobId = `cleanup-${Date.now()}`;
    logger.info(`[${jobId}] Starting orphaned image cleanup job...`);
    try {
        const users = await User.find({}, 'notesTree').lean();
        if (!users || users.length === 0) {
            logger.info(`[${jobId}] No users found. Cleanup job exiting.`);
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
        logger.info(`[${jobId}] Found ${activeImageFilenames.size} unique image filenames referenced in notes.`);

        let filesInUploadDir;
        try {
            filesInUploadDir = await fs.readdir(UPLOAD_DIR);
        } catch (err) {
            if (err.code === 'ENOENT') {
                logger.info(`[${jobId}] Upload directory ${UPLOAD_DIR} does not exist. Nothing to clean.`);
                return;
            }
            throw err; // Re-throw other errors
        }

        logger.info(`[${jobId}] Found ${filesInUploadDir.length} files in the upload directory: ${UPLOAD_DIR}`);
        let deletedCount = 0;
        let failedToDeleteCount = 0;

        for (const filename of filesInUploadDir) {
            if (filename === '.gitkeep') continue;
            if (!activeImageFilenames.has(filename)) {
                try {
                    const filePath = path.join(UPLOAD_DIR, filename);
                    await fs.unlink(filePath);
                    logger.info(`[${jobId}] Deleted orphaned image: ${filename}`);
                    deletedCount++;
                } catch (err) {
                    failedToDeleteCount++;
                    logger.error(`[${jobId}] Error deleting orphaned file ${filename}:`, { message: err.message, stack: err.stack });
                }
            }
        }
        logger.info(`[${jobId}] Orphaned image cleanup job finished. Deleted ${deletedCount} files. Failed to delete ${failedToDeleteCount} files.`);
    } catch (error) {
        logger.error(`[${jobId}] Critical error during orphaned image cleanup job:`, { message: error.message, stack: error.stack });
    }
}

export { cleanupOrphanedImages }; // Assuming ESM