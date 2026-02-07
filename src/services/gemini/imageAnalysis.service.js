/**
 * Image Analysis Service
 * Analyzes images using Gemini Vision to generate detailed descriptions
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { getModel } = require('./gemini.config');

// MIME types mapping
const MIME_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
};

/**
 * Download image from URL and return as base64
 * @param {string} imageUrl - URL of image to download
 * @returns {Promise<{data: string, mimeType: string}>} Base64 data and mime type
 */
async function downloadImageAsBase64(imageUrl) {
    return new Promise((resolve, reject) => {
        const protocol = imageUrl.startsWith('https') ? https : http;
        
        protocol.get(imageUrl, (response) => {
            // Handle redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                return downloadImageAsBase64(response.headers.location)
                    .then(resolve)
                    .catch(reject);
            }
            
            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to download image: ${response.statusCode}`));
            }
            
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const contentType = response.headers['content-type'] || 'image/jpeg';
                resolve({
                    data: buffer.toString('base64'),
                    mimeType: contentType.split(';')[0]
                });
            });
            response.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Analyze a local image file
 * @param {string} imagePath - Path to image file
 * @param {string} customPrompt - Optional custom prompt for analysis
 * @param {string} modelName - Optional model name from user settings
 * @returns {Promise<string>} Detailed image description
 */
async function analyzeImage(imagePath, customPrompt = null, modelName = null) {
    const model = getModel('VISION', modelName);
    
    // Clean and normalize input path
    // 1. URL decode in case of encoded characters
    // 2. Trim whitespace
    const cleanInput = decodeURIComponent(imagePath).trim();
    
    let fullPath;
    
    // Cross-platform check for truly absolute paths:
    // - Windows: Must have drive letter (e.g., C:\... or D:/...)
    // - Linux/Mac: Starts with / BUT we treat /uploads/... as relative to project root
    const hasWindowsDriveLetter = /^[A-Za-z]:[\\/]/.test(cleanInput);
    const isUnixAbsolute = process.platform !== 'win32' && cleanInput.startsWith('/');
    const looksLikeProjectRelative = /^[\\/]?(uploads|public|src|static)[\\/]/i.test(cleanInput);
    
    // Only treat as truly absolute if:
    // 1. Has Windows drive letter, OR
    // 2. Is Unix absolute AND doesn't look like a project-relative path
    const isTrulyAbsolute = hasWindowsDriveLetter || (isUnixAbsolute && !looksLikeProjectRelative);
    
    if (isTrulyAbsolute && fs.existsSync(cleanInput)) {
        fullPath = cleanInput;
    } else {
        // Remove ANY leading slash/backslash to make it truly relative
        const safeRelativePath = cleanInput.replace(/^[\/\\]+/, '');
        
        // Default strategy: project root + relative path
        const path1 = path.join(process.cwd(), safeRelativePath);
        
        // Backup strategy: check if 'uploads' prefix is missing
        const path2 = !safeRelativePath.startsWith('uploads') 
            ? path.join(process.cwd(), 'uploads', safeRelativePath)
            : null;
        
        if (fs.existsSync(path1)) {
            fullPath = path1;
        } else if (path2 && fs.existsSync(path2)) {
            fullPath = path2;
        } else {
            fullPath = path1; // Keep original attempt for error msg
        }
    }

    
    // Normalize slashes for Windows compatibility
    fullPath = path.normalize(fullPath);
    
    if (!fs.existsSync(fullPath)) {
        // Construct detailed error message
        const debugInfo = JSON.stringify({
            attemptedPath: fullPath,
            cwd: process.cwd(),
            inputPath: imagePath,
            dirContent: fs.existsSync(path.dirname(fullPath)) ? fs.readdirSync(path.dirname(fullPath)) : 'Directory not found'
        }, null, 2);
        
        throw new Error(`Image file not found: ${fullPath}. Debug info: ${debugInfo}`);
    }
    
    const imageData = fs.readFileSync(fullPath);
    const base64Image = imageData.toString('base64');
    
    // Detect mime type from extension
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'image/jpeg';
    
    const prompt = customPrompt || `Phân tích hình ảnh này một cách chi tiết. Hãy mô tả:

1. **Nội dung chính**: Đối tượng, người, vật, hoặc cảnh trong ảnh
2. **Màu sắc**: Các màu chủ đạo và palette màu
3. **Phong cách**: Style thiết kế (modern, vintage, minimalist, v.v.)
4. **Bố cục**: Cách sắp xếp các yếu tố trong ảnh
5. **Cảm xúc/Mood**: Không khí, cảm giác mà ảnh truyền tải
6. **Đề xuất sử dụng**: Ảnh này phù hợp cho mục đích gì (marketing, social media, v.v.)

Trả lời lại theo format 6 gạch đầu dòng trên, không cần nói lại Dưới đây là phân tích logo thương hiệu mà
trả lời luôn cho user 6 chi tiết trên
Trả lời bằng tiếng Việt, chi tiết và chuyên nghiệp.`;

    try {
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Image,
                    mimeType: mimeType
                }
            }
        ]);
        
        const response = result.response;
        return response.text();
    } catch (error) {
        console.error('analyzeImage error:', error);
        throw error;
    }
}

/**
 * Analyze an image from URL
 * @param {string} imageUrl - URL of image to analyze
 * @param {string} customPrompt - Optional custom prompt for analysis
 * @param {string} modelName - Optional model name from user settings
 * @returns {Promise<string>} Detailed image description
 */
async function analyzeImageUrl(imageUrl, customPrompt = null, modelName = null) {
    const model = getModel('VISION', modelName);
    
    // Download image as base64
    const { data: base64Image, mimeType } = await downloadImageAsBase64(imageUrl);
    
    const prompt = customPrompt || `Phân tích hình ảnh này một cách chi tiết. Hãy mô tả:

1. **Nội dung chính**: Đối tượng, người, vật, hoặc cảnh trong ảnh
2. **Màu sắc**: Các màu chủ đạo và palette màu
3. **Phong cách**: Style thiết kế (modern, vintage, minimalist, v.v.)
4. **Bố cục**: Cách sắp xếp các yếu tố trong ảnh
5. **Cảm xúc/Mood**: Không khí, cảm giác mà ảnh truyền tải
6. **Đề xuất sử dụng**: Ảnh này phù hợp cho mục đích gì (marketing, social media, v.v.)

Trả lời bằng tiếng Việt, chi tiết và chuyên nghiệp.`;

    try {
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Image,
                    mimeType: mimeType
                }
            }
        ]);
        
        const response = result.response;
        return response.text();
    } catch (error) {
        console.error('analyzeImageUrl error:', error);
        throw error;
    }
}

module.exports = {
    analyzeImage,
    analyzeImageUrl
};
