/**
 * Article Text Service
 * Generates article content from text prompts with dynamic prompt system
 */

const { getModel, parseJsonResponse } = require('./gemini.config');
const { logPromptDebug } = require('../../utils/promptDebug');

// Topic-specific expert roles for dynamic prompts
const TOPIC_ROLES = {
    'marketing_digital': 'chuyên gia Digital Marketing với kinh nghiệm về chiến lược marketing số',
    'social_media': 'Social Media Specialist am hiểu các nền tảng mạng xã hội',
    'ecommerce': 'chuyên gia Thương mại điện tử với kiến thức về bán hàng online',
    'branding': 'chuyên gia xây dựng thương hiệu và brand identity',
    'content_marketing': 'Content Strategist chuyên tạo nội dung marketing',
    'seo_sem': 'SEO/SEM Specialist với kiến thức về tối ưu công cụ tìm kiếm',
    'product_intro': 'chuyên viên giới thiệu sản phẩm và copywriter',
    'promotion': 'Event & Promotion Specialist chuyên về sự kiện, khuyến mãi'
};

// Topic labels for display
const TOPIC_LABELS = {
    'marketing_digital': 'Marketing Digital',
    'social_media': 'Social Media',
    'ecommerce': 'Thương mại điện tử',
    'branding': 'Xây dựng thương hiệu',
    'content_marketing': 'Content Marketing',
    'seo_sem': 'SEO & SEM',
    'product_intro': 'Giới thiệu sản phẩm',
    'promotion': 'Sự kiện & Khuyến mãi'
};

// Purpose-specific context
const PURPOSE_CONTEXT = {
    'introduce': 'thu hút sự chú ý, giới thiệu giá trị, tạo ấn tượng đầu tiên tốt đẹp với người đọc',
    'sell': 'thuyết phục mua hàng, tạo cảm giác cấp bách, có CTA (call-to-action) mạnh mẽ và rõ ràng',
    'share_knowledge': 'chia sẻ thông tin hữu ích, xây dựng uy tín chuyên môn, tăng tương tác cộng đồng',
    'brand_awareness': 'mở rộng độ phủ thương hiệu, tăng mức độ ghi nhớ và nhận biết trong tâm trí khách hàng',
    'attract_leads': 'thu hút khách hàng tiềm năng, kích thích để lại thông tin hoặc hành động quan tâm ban đầu',
    'nurture_educate': 'nuôi dưỡng khách hàng bằng nội dung giáo dục, giúp họ hiểu vấn đề và giải pháp phù hợp',
    'convert_sales': 'thúc đẩy quyết định mua, nhấn mạnh lợi ích, xử lý do dự và CTA chuyển đổi rõ ràng',
    'retention_loyalty': 'duy trì kết nối sau mua, gia tăng sự hài lòng, lòng trung thành và tần suất quay lại',
    'brand_positioning': 'khắc họa vị thế khác biệt của thương hiệu, làm rõ giá trị cốt lõi và lý do nên chọn'
};

// Purpose labels
const PURPOSE_LABELS = {
    'introduce': 'Giới thiệu sản phẩm/dịch vụ',
    'sell': 'Bán hàng/khuyến mãi',
    'share_knowledge': 'Chia sẻ kiến thức',
    'brand_awareness': 'Tăng nhận diện thương hiệu',
    'attract_leads': 'Thu hút khách hàng tiềm năng',
    'nurture_educate': 'Nuôi dưỡng & giáo dục khách hàng',
    'convert_sales': 'Chuyển đổi bán hàng',
    'retention_loyalty': 'Duy trì & trung thành',
    'brand_positioning': 'Định vị thương hiệu'
};

// Writing style directives
const WRITING_STYLE_DIRECTIVES = {
    sales: 'Nhịp nhanh, rõ ý, tập trung lợi ích và chốt CTA mạnh mẽ.',
    lifestyle: 'Giọng trầm, giàu hình ảnh, có hơi thở người thật và trải nghiệm đời sống.',
    technical: 'Rõ ràng, tuần tự, giải thích chính xác, không lan man.',
    balanced: 'Cân bằng giữa cảm xúc và thông tin, thuyết phục nhưng tự nhiên.'
};

// Storytelling depth guidance
const STORYTELLING_DEPTH_GUIDANCE = {
    low: 'Mức kể chuyện THẤP: đi thẳng vào trọng tâm, tối thiểu yếu tố dẫn chuyện, ưu tiên súc tích.',
    medium: 'Mức kể chuyện TRUNG BÌNH: có mở bài ngắn theo ngữ cảnh và ví dụ thực tế vừa đủ.',
    high: 'Mức kể chuyện CAO: xây dựng mạch kể rõ ràng (bối cảnh -> vấn đề -> chuyển biến -> kết nối CTA).'
};

/**
 * Build dynamic prompt based on inputs
 * @param {Object} params - Prompt parameters
 * @returns {string} Complete prompt string
 */
function buildDynamicPrompt({
    topic,
    purpose,
    description,
    wordCount,
    brandContext,
    writingStyle = 'balanced',
    storytellingDepth = 'medium',
    baseTitle = null,
    baseContent = null,
    regenerateInstruction = null
}) {
    const normalizedWritingStyle = WRITING_STYLE_DIRECTIVES[writingStyle] ? writingStyle : 'balanced';
    const normalizedStorytellingDepth = STORYTELLING_DEPTH_GUIDANCE[storytellingDepth] ? storytellingDepth : 'medium';
    const role = TOPIC_ROLES[topic] || 'chuyên gia viết content marketing';
    const topicLabel = TOPIC_LABELS[topic] || topic;
    const purposeGuide = PURPOSE_CONTEXT[purpose] || purpose;
    const purposeLabel = PURPOSE_LABELS[purpose] || purpose;
    const styleDirective = WRITING_STYLE_DIRECTIVES[normalizedWritingStyle];
    const storytellingGuide = STORYTELLING_DEPTH_GUIDANCE[normalizedStorytellingDepth];
    const safeDescription = description || 'Không có mô tả thêm, hãy suy luận hợp lý từ các thông tin còn lại.';
    
    let prompt = `Bạn là ${role}.

## YÊU CẦU TỪ NGƯỜI DÙNG
- **Chủ đề:** ${topicLabel}
- **Mục đích:** ${purposeLabel} - ${purposeGuide}
- **Mô tả chi tiết từ người dùng:** ${safeDescription}
- **Độ dài yêu cầu:** CHÍNH XÁC ${wordCount} từ (bắt buộc, rất quan trọng!)`;

    prompt += `

## ĐỊNH HƯỚNG PHONG CÁCH VIẾT
- **Writing style:** ${normalizedWritingStyle}
- **Chỉ dẫn phong cách:** ${styleDirective}
- **Storytelling depth:** ${normalizedStorytellingDepth}
- **Hướng dẫn chiều sâu kể chuyện:** ${storytellingGuide}`;

    if (baseContent) {
        prompt += `

## NỀN TẢNG BÀI VIẾT HIỆN CÓ
- **Tiêu đề hiện có:** ${baseTitle || 'Không có'}
- **Nội dung hiện có:**
${baseContent}
- **Yêu cầu regenerate/cải thiện:** ${regenerateInstruction || 'Làm mới bài viết để rõ ràng hơn, hấp dẫn hơn nhưng không mất ý chính.'}

### Hướng dẫn cải thiện từ bài gốc (bắt buộc tuân thủ)
- Giữ lại thông điệp cốt lõi và các ý chính quan trọng của bài hiện có.
- Được phép tái cấu trúc câu chữ, mở rộng hoặc cô đọng để bài tốt hơn.
- Không làm sai lệch dữ kiện quan trọng, không đánh mất trọng tâm ban đầu.
- Kết quả phải là phiên bản cải thiện/regenerate chất lượng cao hơn, không phải viết lại hoàn toàn thiếu liên kết.`;
    }

    if (brandContext) {
        prompt += `

## THÔNG TIN THƯƠNG HIỆU (Bắt buộc tuân thủ)
${brandContext}

### Hướng dẫn sử dụng thông tin thương hiệu:
- Sử dụng tên thương hiệu và từ khóa một cách TỰ NHIÊN trong nội dung
- Áp dụng tone giọng điệu đã định nghĩa xuyên suốt bài viết
- Xưng hô khách hàng theo customerTerm và xưng hô thương hiệu theo brandPronoun nếu có
- Nhấn mạnh điểm mạnh sản phẩm/dịch vụ, nhóm sản phẩm trọng tâm và bối cảnh diễn đạt phù hợp
- Nếu có resource insights, tận dụng làm chất liệu ngôn ngữ và hình ảnh mô tả nhất quán
- KHÔNG làm bài viết trở nên gượng ép hay quảng cáo quá lộ liễu`;
    }

    prompt += `

## YÊU CẦU OUTPUT
1. Tiêu đề hấp dẫn, có emoji phù hợp với chủ đề
2. Nội dung tự nhiên, dễ đọc, phù hợp với Facebook
3. Có call-to-action rõ ràng phù hợp với mục đích bài viết
4. Độ dài CHÍNH XÁC ${wordCount} từ
5. Phong cách phù hợp với chủ đề và mục đích đã chọn
6. Hashtags liên quan và hấp dẫn
 
## FORMAT JSON TRẢ VỀ
{
    "title": "Tiêu đề bài viết với emoji",
    "content": "Nội dung bài viết đầy đủ với độ dài ${wordCount} từ",
    "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"]
}

Chỉ trả về JSON, không có text thêm.`;

    return prompt;
}

/**
 * Generate article content from prompt
 * @param {Object} params - Generation parameters
 * @param {string} params.topic - Article topic
 * @param {string} params.purpose - Article purpose (introduce, sell, share_knowledge)
 * @param {string} params.description - User's description
 * @param {number} params.wordCount - Desired word count (default 250)
 * @param {string} params.brandContext - Optional brand context from AI Settings
 * @param {'sales'|'lifestyle'|'technical'|'balanced'} params.writingStyle - Optional writing style
 * @param {'low'|'medium'|'high'} params.storytellingDepth - Optional storytelling depth
 * @param {string|null} params.baseTitle - Optional base article title for regeneration
 * @param {string|null} params.baseContent - Optional base article content for regeneration
 * @param {string|null} params.regenerateInstruction - Optional regenerate instruction
 * @param {string} params.modelName - Optional model name from user settings
 * @returns {Promise<Object>} Generated article
 */
async function generateArticleContent({
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
    
    const prompt = buildDynamicPrompt({
        topic,
        purpose,
        description,
        wordCount,
        brandContext,
        writingStyle,
        storytellingDepth,
        baseTitle,
        baseContent,
        regenerateInstruction
    });

    logPromptDebug({
        tool: 'article',
        step: 'prompt-built',
        data: {
            modelName,
            topic,
            purpose,
            wordCount,
            writingStyle,
            storytellingDepth,
            promptPreview: prompt
        }
    });

    try {
        const result = await model.generateContent(prompt);
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
        console.error('articleText.service error:', error);
        throw error;
    }
}

module.exports = {
    generateArticleContent,
    buildDynamicPrompt,
    TOPIC_ROLES,
    TOPIC_LABELS,
    PURPOSE_LABELS,
    PURPOSE_CONTEXT
};
