/**
 * Article Vision Service
 * Generates article content by analyzing uploaded images
 */

const fs = require('fs');
const path = require('path');
const { getModel, PURPOSE_LABELS, parseJsonResponse } = require('./gemini.config');
const { generateArticleContent } = require('./articleText.service');
const { injectBrandContextToPrompt } = require('./brandContext.service');
const { logPromptDebug } = require('../../utils/promptDebug');

const WRITING_STYLE_DIRECTIVES = {
    sales: 'Nhịp nhanh, rõ ý, CTA mạnh.',
    lifestyle: 'Giọng trầm, giàu hình ảnh, có hơi thở người thật.',
    technical: 'Rõ ràng, tuần tự, không lan man.',
    balanced: 'Cân bằng giữa cảm xúc và thông tin.'
};

const STORYTELLING_DEPTH_GUIDANCE = {
    low: 'Kể chuyện thấp: đi thẳng trọng tâm, ngắn gọn.',
    medium: 'Kể chuyện vừa: có bối cảnh ngắn và ví dụ thực tế.',
    high: 'Kể chuyện cao: mạch rõ bối cảnh -> vấn đề -> giải pháp -> CTA.'
};

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
 * @param {'sales'|'lifestyle'|'technical'|'balanced'} params.writingStyle - Optional writing style
 * @param {'low'|'medium'|'high'} params.storytellingDepth - Optional storytelling depth
 * @param {string|null} params.baseTitle - Optional base title for regeneration
 * @param {string|null} params.baseContent - Optional base content for regeneration
 * @param {string|null} params.regenerateInstruction - Optional regenerate instruction
 * @param {string|null} params.modelName - Optional model name override
 * @returns {Promise<Object>} Generated article
 */
async function generateArticleWithImage({
    topic,
    purpose,
    description,
    wordCount = 250,
    imagePath,
    brandContext = null,
    writingStyle = 'balanced',
    storytellingDepth = 'medium',
    baseTitle = null,
    baseContent = null,
    regenerateInstruction = null,
    modelName = null
}) {
    const model = getModel('VISION', modelName);
    const normalizedWritingStyle = WRITING_STYLE_DIRECTIVES[writingStyle] ? writingStyle : 'balanced';
    const normalizedStorytellingDepth = STORYTELLING_DEPTH_GUIDANCE[storytellingDepth] ? storytellingDepth : 'medium';

    // Read image file
    const fullPath = path.join(process.cwd(), imagePath.replace(/^\//, ''));
    
    if (!fs.existsSync(fullPath)) {
        // If image not found, fallback to text-only generation
        logPromptDebug({
            tool: 'article',
            step: 'prompt-built',
            data: {
                mode: 'vision-fallback-text',
                reason: 'image-not-found',
                imagePath: fullPath
            }
        });
        return generateArticleContent({
            topic,
            purpose,
            description,
            wordCount,
            brandContext,
            writingStyle,
            storytellingDepth,
            baseTitle,
            baseContent,
            regenerateInstruction,
            modelName
        });
    }

    const imageData = fs.readFileSync(fullPath);
    const base64Image = imageData.toString('base64');
    
    // Detect mime type from extension
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'image/jpeg';
    const styleDirective = WRITING_STYLE_DIRECTIVES[normalizedWritingStyle];
    const storytellingGuide = STORYTELLING_DEPTH_GUIDANCE[normalizedStorytellingDepth];
    const safeDescription = description || 'Không có mô tả thêm, hãy dựa vào hình ảnh và thông tin còn lại.';

    // Build base prompt
    let basePrompt = `Bạn là một chuyên gia viết content marketing chuyên nghiệp. Hãy phân tích hình ảnh này và tạo một bài viết Facebook hoàn chỉnh.

**Chủ đề:** ${topic}
**Mục đích:** ${PURPOSE_LABELS[purpose] || purpose}
**Mô tả từ người dùng:** ${safeDescription}
**Độ dài yêu cầu:** ${wordCount} từ
**Writing style:** ${normalizedWritingStyle}
**Chỉ dẫn phong cách:** ${styleDirective}
**Storytelling depth:** ${normalizedStorytellingDepth}
**Hướng dẫn kể chuyện:** ${storytellingGuide}

**Yêu cầu:**
1. Phân tích kỹ hình ảnh để tạo nội dung phù hợp
2. Tiêu đề hấp dẫn, có emoji phù hợp
3. Nội dung tự nhiên, mô tả được hình ảnh một cách sáng tạo
4. Có call-to-action rõ ràng
5. Độ dài ĐÚNG ${wordCount} từ (bắt buộc, rất quan trọng!)
6. Nếu có brandPronoun/customerTerm trong brand context thì phải tuân thủ nhất quán cách xưng hô`;

    if (baseContent) {
        basePrompt += `

## NỀN TẢNG BÀI VIẾT HIỆN CÓ
- **Tiêu đề hiện có:** ${baseTitle || 'Không có'}
- **Nội dung hiện có:**
${baseContent}
- **Yêu cầu regenerate/cải thiện:** ${regenerateInstruction || 'Cải thiện bài viết rõ ràng hơn, hấp dẫn hơn nhưng không mất ý chính.'}

### Hướng dẫn cải thiện từ bài gốc
- Giữ lại ý chính và thông điệp cốt lõi từ bài hiện có.
- Tối ưu lại cấu trúc, ngôn từ và nhịp điệu theo writing style đã chọn.
- Không làm sai lệch thông tin quan trọng, không làm mất trọng tâm.`;
    }

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

    logPromptDebug({
        tool: 'article',
        step: 'prompt-built',
        data: {
            modelName,
            topic,
            purpose,
            wordCount,
            writingStyle: normalizedWritingStyle,
            storytellingDepth: normalizedStorytellingDepth,
            promptPreview: finalPrompt,
            imagePath
        }
    });

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

        logPromptDebug({
            tool: 'article',
            step: 'ai-response',
            data: {
                modelName,
                responsePreview: text
            }
        });
        
        const parsed = parseJsonResponse(text);
        if (parsed) {
            return parsed;
        }
        
        throw new Error('Invalid response format from Gemini');
    } catch (error) {
        logPromptDebug({
            tool: 'article',
            step: 'ai-response-error',
            data: {
                modelName,
                message: error?.message,
                stack: error?.stack
            }
        });
        console.error('articleVision.service error:', error);
        throw error;
    }
}

module.exports = {
    generateArticleWithImage
};
