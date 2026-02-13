/**
 * Image Generation Service
 * Generates images using Gemini 2.0 Flash native image generation
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { genAI, getModel, PURPOSE_LABELS, parseJsonResponse } = require('./gemini.config');
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

// Upload directory for AI-generated images
const AI_IMAGES_DIR = path.join(process.cwd(), 'uploads', 'images', 'ai-images');

// Ensure directory exists
if (!fs.existsSync(AI_IMAGES_DIR)) {
    fs.mkdirSync(AI_IMAGES_DIR, { recursive: true });
}

/**
 * Generate image using Gemini 2.0 Flash native image generation
 * @param {string} prompt - Image generation prompt
 * @param {Object} options - Generation options
 * @returns {Promise<string>} URL path to saved image
 */
async function generateImage(prompt, options = {}) {
    try {
        // Use Gemini 2.0 Flash experimental for native image generation
        const { MODELS } = require('./gemini.config');
        const imageModel = genAI.getGenerativeModel({ 
            model: MODELS.IMAGE_GEN,
            generationConfig: {
                responseModalities: ['TEXT', 'IMAGE']
            }
        });
        
        // Enhanced prompt for better image generation
        const enhancedPrompt = `Create a high-quality, professional marketing image: ${prompt}. The image should be visually appealing, suitable for social media marketing, with vibrant colors and clean composition.`;

        logPromptDebug({
            tool: 'article',
            step: 'prompt-built',
            data: {
                mode: 'image-generation',
                promptPreview: enhancedPrompt,
                options
            }
        });
        
        const result = await imageModel.generateContent(enhancedPrompt);
        const response = result.response;
        
        // Check for image parts in response
        if (response.candidates && response.candidates[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
                    // Get base64 image data
                    const imageData = part.inlineData.data;
                    const mimeType = part.inlineData.mimeType;
                    
                    // Determine file extension
                    const ext = mimeType === 'image/png' ? 'png' : 
                               mimeType === 'image/webp' ? 'webp' : 'jpg';
                    
                    // Save image to disk
                    const filename = `${uuidv4()}.${ext}`;
                    const filePath = path.join(AI_IMAGES_DIR, filename);
                    
                    // Decode base64 and save
                    const imageBuffer = Buffer.from(imageData, 'base64');
                    fs.writeFileSync(filePath, imageBuffer);

                    logPromptDebug({
                        tool: 'article',
                        step: 'ai-response',
                        data: {
                            mode: 'image-generation',
                            success: true,
                            imagePath: filePath,
                            mimeType
                        }
                    });
                    
                    // Return URL path
                    return `/uploads/images/ai-images/${filename}`;
                }
            }
        }

        throw new Error('No image generated in response');
    } catch (error) {
        logPromptDebug({
            tool: 'article',
            step: 'ai-response-error',
            data: {
                mode: 'image-generation',
                message: error?.message,
                stack: error?.stack
            }
        });
        console.error('imageGen.service error:', error.message);
        
        // Fallback to Unsplash if generation fails
        const keywords = encodeURIComponent(prompt.slice(0, 50));
        return `https://source.unsplash.com/800x450/?${keywords}`;
    }
}

/**
 * Generate article content with AI-generated image
 * @param {Object} params - Generation parameters
 * @param {string} params.topic - Article topic
 * @param {string} params.purpose - Article purpose
 * @param {string} params.description - User's description
 * @param {number} params.wordCount - Desired word count
 * @param {string|null} params.brandContext - Brand context from AI Settings
 * @param {'sales'|'lifestyle'|'technical'|'balanced'} params.writingStyle - Optional writing style
 * @param {'low'|'medium'|'high'} params.storytellingDepth - Optional storytelling depth
 * @param {string|null} params.baseTitle - Optional base title for regeneration
 * @param {string|null} params.baseContent - Optional base content for regeneration
 * @param {string|null} params.regenerateInstruction - Optional regenerate instruction
 * @param {string|null} params.modelName - Optional model name override
 * @returns {Promise<Object>} Article with generated image URL
 */
async function generateArticleWithAIImage({
    topic,
    purpose,
    description,
    wordCount = 250,
    brandContext = null,
    writingStyle = 'balanced',
    storytellingDepth = 'medium',
    baseTitle = null,
    baseContent = null,
    regenerateInstruction = null,
    modelName = null
}) {
    const model = getModel('TEXT', modelName);
    const normalizedWritingStyle = WRITING_STYLE_DIRECTIVES[writingStyle] ? writingStyle : 'balanced';
    const normalizedStorytellingDepth = STORYTELLING_DEPTH_GUIDANCE[storytellingDepth] ? storytellingDepth : 'medium';
    const styleDirective = WRITING_STYLE_DIRECTIVES[normalizedWritingStyle];
    const storytellingGuide = STORYTELLING_DEPTH_GUIDANCE[normalizedStorytellingDepth];
    const safeDescription = description || 'Không có mô tả thêm, hãy triển khai phù hợp theo chủ đề và mục đích.';

    // Build base prompt
    let basePrompt = `Bạn là một chuyên gia viết content marketing chuyên nghiệp. Hãy tạo một bài viết Facebook hoàn chỉnh VÀ mô tả một hình ảnh phù hợp.

**Chủ đề:** ${topic}
**Mục đích:** ${PURPOSE_LABELS[purpose] || purpose}
**Mô tả từ người dùng:** ${safeDescription}
**Độ dài yêu cầu:** ${wordCount} từ
**Writing style:** ${normalizedWritingStyle}
**Chỉ dẫn phong cách:** ${styleDirective}
**Storytelling depth:** ${normalizedStorytellingDepth}
**Hướng dẫn kể chuyện:** ${storytellingGuide}

**Yêu cầu:**
1. Tiêu đề hấp dẫn, có emoji phù hợp
2. Nội dung tự nhiên, dễ đọc, phù hợp với Facebook
3. Có call-to-action rõ ràng
4. Độ dài ĐÚNG ${wordCount} từ (bắt buộc, rất quan trọng!)
5. Mô tả hình ảnh chi tiết bằng TIẾNG ANH để tạo ảnh AI
6. Nếu brand context có customerTerm/brandPronoun/productGroups/strengths/resource insights thì bắt buộc phản ánh trong content và imagePrompt ở mức tự nhiên`;

    if (baseContent) {
        basePrompt += `

## NỀN TẢNG BÀI VIẾT HIỆN CÓ
- **Tiêu đề hiện có:** ${baseTitle || 'Không có'}
- **Nội dung hiện có:**
${baseContent}
- **Yêu cầu regenerate/cải thiện:** ${regenerateInstruction || 'Cải thiện bài viết nhưng không mất ý chính.'}

### Hướng dẫn cải thiện từ bài gốc
- Giữ lại thông điệp cốt lõi và các ý chính quan trọng.
- Cải tiến cấu trúc, diễn đạt và sức thuyết phục theo phong cách đã chọn.
- Tránh làm sai lệch dữ kiện hoặc lệch mục đích ban đầu.`;
    }

    // Inject brand context if available
    const promptWithBrand = injectBrandContextToPrompt(basePrompt, brandContext);

    // Add JSON format instruction
    const finalPrompt = promptWithBrand + `

**Trả về JSON với format:**
{
    "title": "Tiêu đề bài viết",
    "content": "Nội dung bài viết đầy đủ với độ dài ${wordCount} từ",
    "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"],
    "imagePrompt": "Detailed English description for AI image generation: describe the scene, style (photorealistic/illustrated/3D), colors, composition, lighting, mood. Example: A professional product photo of a sleek smartphone on a marble surface, soft studio lighting, minimalist style, white background with subtle shadows."
}

Chỉ trả về JSON, không có text thêm.`;

    logPromptDebug({
        tool: 'article',
        step: 'prompt-built',
        data: {
            mode: 'ai-image',
            modelName,
            topic,
            purpose,
            wordCount,
            writingStyle: normalizedWritingStyle,
            storytellingDepth: normalizedStorytellingDepth,
            promptPreview: finalPrompt
        }
    });

    try {
        // Step 1: Generate article content with image prompt
        const result = await model.generateContent(finalPrompt);
        const response = result.response;
        const text = response.text();

        logPromptDebug({
            tool: 'article',
            step: 'ai-response',
            data: {
                mode: 'ai-image-text-pass',
                modelName,
                responsePreview: text
            }
        });
        
        const parsed = parseJsonResponse(text);
        if (!parsed) {
            throw new Error('Invalid response format from Gemini');
        }

        // Step 2: Generate actual image using the imagePrompt
        if (parsed.imagePrompt) {
            parsed.imageUrl = await generateImage(parsed.imagePrompt);
            logPromptDebug({
                tool: 'article',
                step: 'ai-response',
                data: {
                    mode: 'ai-image-final',
                    imagePromptPreview: parsed.imagePrompt,
                    imageUrl: parsed.imageUrl
                }
            });
        }

        return parsed;
    } catch (error) {
        logPromptDebug({
            tool: 'article',
            step: 'ai-response-error',
            data: {
                mode: 'ai-image',
                modelName,
                message: error?.message,
                stack: error?.stack
            }
        });
        console.error('generateArticleWithAIImage error:', error);
        throw error;
    }
}

module.exports = {
    generateImage,
    generateArticleWithAIImage
};
