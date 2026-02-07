/**
 * Article Text Service
 * Generates article content from text prompts with dynamic prompt system
 */

const { getModel, parseJsonResponse } = require('./gemini.config');

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
    'share_knowledge': 'chia sẻ thông tin hữu ích, xây dựng uy tín chuyên môn, tăng tương tác cộng đồng'
};

// Purpose labels
const PURPOSE_LABELS = {
    'introduce': 'Giới thiệu sản phẩm/dịch vụ',
    'sell': 'Bán hàng/khuyến mãi',
    'share_knowledge': 'Chia sẻ kiến thức'
};

/**
 * Build dynamic prompt based on inputs
 * @param {Object} params - Prompt parameters
 * @returns {string} Complete prompt string
 */
function buildDynamicPrompt({ topic, purpose, description, wordCount, brandContext }) {
    const role = TOPIC_ROLES[topic] || 'chuyên gia viết content marketing';
    const topicLabel = TOPIC_LABELS[topic] || topic;
    const purposeGuide = PURPOSE_CONTEXT[purpose] || purpose;
    const purposeLabel = PURPOSE_LABELS[purpose] || purpose;
    
    let prompt = `Bạn là ${role}.

## YÊU CẦU TỪ NGƯỜI DÙNG
- **Chủ đề:** ${topicLabel}
- **Mục đích:** ${purposeLabel} - ${purposeGuide}
- **Mô tả chi tiết từ người dùng:** ${description}
- **Độ dài yêu cầu:** CHÍNH XÁC ${wordCount} từ (bắt buộc, rất quan trọng!)`;

    if (brandContext) {
        prompt += `

## THÔNG TIN THƯƠNG HIỆU (Bắt buộc tuân thủ)
${brandContext}

### Hướng dẫn sử dụng thông tin thương hiệu:
- Sử dụng tên thương hiệu và từ khóa một cách TỰ NHIÊN trong nội dung
- Áp dụng tone giọng điệu đã định nghĩa xuyên suốt bài viết
- Nhấn mạnh điểm mạnh sản phẩm/dịch vụ khi phù hợp với ngữ cảnh
- Xưng hô khách hàng theo cách đã thiết lập
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
 * @param {string} params.modelName - Optional model name from user settings
 * @returns {Promise<Object>} Generated article
 */
async function generateArticleContent({ topic, purpose, description, wordCount = 250, brandContext = null, modelName = null }) {
    const model = getModel('TEXT', modelName);
    
    const prompt = buildDynamicPrompt({ topic, purpose, description, wordCount, brandContext });

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();
        
        const parsed = parseJsonResponse(text);
        if (parsed) {
            return parsed;
        }
        
        throw new Error('Invalid response format from Gemini');
    } catch (error) {
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
