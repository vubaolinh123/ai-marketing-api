/**
 * Article Vision Service
 * Generates article content by analyzing uploaded images
 */

const fs = require('fs');
const path = require('path');
const { getModel, PURPOSE_LABELS, parseJsonResponse } = require('./gemini.config');
const { generateArticleContent } = require('./articleText.service');
const { injectBrandContextToPrompt } = require('./brandContext.service');

// MIME types mapping
const MIME_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
};

/**
 * Generate article with image analysis (for manual mode)
 * @param {Object} params - Generation parameters
 * @param {string} params.topic - Article topic
 * @param {string} params.purpose - Article purpose
 * @param {string} params.description - User's description
 * @param {number} params.wordCount - Desired word count
 * @param {string} params.imagePath - Path to uploaded image
 * @param {string|null} params.brandContext - Brand context from AI Settings
 * @returns {Promise<Object>} Generated article
 */
async function generateArticleWithImage({ topic, purpose, description, wordCount = 250, imagePath, brandContext = null }) {
    const model = getModel('VISION');

    // Read image file
    const fullPath = path.join(process.cwd(), imagePath.replace(/^\//, ''));
    
    if (!fs.existsSync(fullPath)) {
        // If image not found, fallback to text-only generation
        console.warn('Image not found, falling back to text generation:', fullPath);
        return generateArticleContent({ topic, purpose, description, wordCount, brandContext });
    }

    const imageData = fs.readFileSync(fullPath);
    const base64Image = imageData.toString('base64');
    
    // Detect mime type from extension
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'image/jpeg';

    // Build base prompt
    let basePrompt = `Bạn là một chuyên gia viết content marketing chuyên nghiệp. Hãy phân tích hình ảnh này và tạo một bài viết Facebook hoàn chỉnh.

**Chủ đề:** ${topic}
**Mục đích:** ${PURPOSE_LABELS[purpose] || purpose}
**Mô tả từ người dùng:** ${description}
**Độ dài yêu cầu:** ${wordCount} từ

**Yêu cầu:**
1. Phân tích kỹ hình ảnh để tạo nội dung phù hợp
2. Tiêu đề hấp dẫn, có emoji phù hợp
3. Nội dung tự nhiên, mô tả được hình ảnh một cách sáng tạo
4. Có call-to-action rõ ràng
5. Độ dài ĐÚNG ${wordCount} từ (bắt buộc, rất quan trọng!)`;

    // Inject brand context if available
    const prompt = injectBrandContextToPrompt(basePrompt, brandContext);

    // Add JSON format instruction
    const finalPrompt = prompt + `

**Trả về JSON với format:**
{
    "title": "Tiêu đề bài viết",
    "content": "Nội dung bài viết đầy đủ với độ dài ${wordCount} từ",
    "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"]
}

Chỉ trả về JSON, không có text thêm.`;

    try {
        const result = await model.generateContent([
            finalPrompt,
            {
                inlineData: {
                    data: base64Image,
                    mimeType: mimeType
                }
            }
        ]);
        
        const response = result.response;
        const text = response.text();
        
        const parsed = parseJsonResponse(text);
        if (parsed) {
            return parsed;
        }
        
        throw new Error('Invalid response format from Gemini');
    } catch (error) {
        console.error('articleVision.service error:', error);
        throw error;
    }
}

module.exports = {
    generateArticleWithImage
};
