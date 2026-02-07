/**
 * File Cleanup Utility
 * Helper functions to delete files from URL paths
 */

const fs = require('fs');
const path = require('path');

/**
 * Delete a file from disk given its URL path
 * @param {string} urlPath - URL path like /uploads/images/articles/filename.jpg
 * @returns {Promise<{deleted: boolean, notFound: boolean, error: string|null}>}
 */
async function deleteFileFromPath(urlPath) {
    if (!urlPath) {
        return { deleted: false, notFound: true, error: null };
    }
    
    try {
        // Remove leading slash and construct full path
        const relativePath = urlPath.startsWith('/') ? urlPath.substring(1) : urlPath;
        const fullPath = path.join(process.cwd(), relativePath);
        
        // Check if file exists
        if (!fs.existsSync(fullPath)) {
            return { deleted: false, notFound: true, error: null };
        }
        
        // Delete the file
        fs.unlinkSync(fullPath);
        console.log(`File deleted: ${fullPath}`);
        return { deleted: true, notFound: false, error: null };
    } catch (error) {
        console.error(`Error deleting file ${urlPath}:`, error.message);
        return { deleted: false, notFound: false, error: error.message };
    }
}

/**
 * Delete multiple files from disk given their URL paths
 * @param {string[]} urlPaths - Array of URL paths
 * @returns {Promise<{filesDeleted: number, filesNotFound: string[]}>}
 */
async function deleteFilesFromPaths(urlPaths) {
    const results = {
        filesDeleted: 0,
        filesNotFound: []
    };
    
    for (const urlPath of urlPaths) {
        if (!urlPath) continue;
        
        const result = await deleteFileFromPath(urlPath);
        if (result.deleted) {
            results.filesDeleted++;
        } else if (result.notFound) {
            results.filesNotFound.push(urlPath);
        }
    }
    
    return results;
}

module.exports = {
    deleteFileFromPath,
    deleteFilesFromPaths
};
