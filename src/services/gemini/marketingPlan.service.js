/**
 * Marketing Plan Service
 * AI-powered content calendar generation using Gemini
 */

const { getModel } = require('./gemini.config');
const { injectBrandContextToPrompt } = require('./brandContext.service');

/**
 * Build prompt for marketing plan generation
 * @param {Object} input - Marketing plan input data
 * @returns {string} Formatted prompt
 */
function buildMarketingPlanPrompt(input) {
    const goalsText = input.goals?.length > 0 
        ? input.goals.map(g => {
            switch(g) {
                case 'engagement': return 'Tăng tương tác';
                case 'sales': return 'Bán hàng';
                case 'awareness': return 'Nhận diện thương hiệu';
                case 'traffic': return 'Tăng traffic website';
                case 'leads': return 'Thu thập leads';
                default: return g;
            }
        }).join(', ')
        : 'Tăng tương tác';

    const channelsText = input.channels?.map(c => {
        switch(c) {
            case 'facebook': return 'Facebook';
            case 'instagram': return 'Instagram';
            case 'tiktok': return 'TikTok';
            case 'website': return 'Website/Blog';
            case 'zalo': return 'Zalo';
            default: return c;
        }
    }).join(', ') || 'Facebook';

    return `
Bạn là chuyên gia Marketing với 10+ năm kinh nghiệm lên kế hoạch content cho social media.

## THÔNG TIN CHIẾN DỊCH
- **Tên chiến dịch:** ${input.campaignName}
- **Thời gian:** từ ${input.startDate} đến ${input.endDate}
- **Số bài/tuần:** ${input.postsPerWeek} bài
- **Khung giờ đăng ưu tiên:** ${input.postTimes?.join(', ') || '18:00'}
- **Chủ đề nội dung:** ${input.topics?.join(', ') || 'Nội dung chung'}
- **Mục tiêu:** ${goalsText}
- **Kênh đăng:** ${channelsText}
${input.notes ? `- **Yêu cầu đặc biệt:** ${input.notes}` : ''}

## NHIỆM VỤ
Tạo content calendar chi tiết với từng bài đăng. Mỗi bài cần có:
1. Ngày và giờ đăng cụ thể
2. Chủ đề và ý tưởng nội dung chi tiết
3. Mục đích bài đăng
4. Loại bài phù hợp với từng kênh
5. Hashtags gợi ý

## QUY TẮC QUAN TRỌNG
1. Phân bổ bài đăng đều trong tuần theo số bài/tuần đã chỉ định
2. Đa dạng postType: image cho nội dung đẹp mắt, video cho demo/tutorial, story cho tương tác nhanh, reel cho TikTok/Instagram
3. Ý tưởng nội dung phải CỤ THỂ, SÁNG TẠO, có thể thực hiện được ngay
4. Mỗi bài có mục đích rõ ràng (engagement, sales, awareness, traffic, leads)
5. Hashtags liên quan đến chủ đề, xu hướng và ngành

## OUTPUT FORMAT
Trả về CHÍNH XÁC một JSON array (không có markdown, không có giải thích):
[
    {
        "date": "YYYY-MM-DD",
        "time": "HH:mm",
        "topic": "Tiêu đề chủ đề ngắn gọn",
        "channel": "facebook|instagram|tiktok|website|zalo",
        "contentIdea": "Mô tả chi tiết ý tưởng nội dung (2-3 câu)",
        "purpose": "engagement|sales|awareness|traffic|leads",
        "postType": "image|video|story|blog|reel",
        "suggestedHashtags": ["hashtag1", "hashtag2", "hashtag3"]
    }
]

CHỈ TRẢ VỀ JSON ARRAY, KHÔNG CÓ GÌ KHÁC.`;
}

/**
 * Parse AI response to extract posts array
 * @param {string} responseText - Raw AI response
 * @param {Object} input - Original input for fallback
 * @returns {Array} Parsed posts array
 */
function parseMarketingPlanResponse(responseText, input) {
    try {
        // Clean response - remove any markdown code blocks
        let cleanText = responseText
            .replace(/```json\n?/gi, '')
            .replace(/```\n?/gi, '')
            .trim();

        // Try to find JSON array
        const arrayMatch = cleanText.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            const posts = JSON.parse(arrayMatch[0]);
            
            // Validate and clean each post
            return posts.map((post, index) => ({
                date: new Date(post.date),
                time: post.time || '18:00',
                topic: post.topic || `Bài đăng ${index + 1}`,
                channel: validateChannel(post.channel) || input.channels[0] || 'facebook',
                status: 'scheduled',
                contentIdea: post.contentIdea || '',
                purpose: validatePurpose(post.purpose) || 'engagement',
                postType: validatePostType(post.postType) || 'image',
                suggestedHashtags: Array.isArray(post.suggestedHashtags) 
                    ? post.suggestedHashtags.slice(0, 10) 
                    : []
            }));
        }

        throw new Error('Không tìm thấy JSON array trong response');
    } catch (error) {
        console.error('Parse marketing plan error:', error);
        throw new Error('Lỗi parse response từ AI: ' + error.message);
    }
}

/**
 * Validate channel value
 */
function validateChannel(channel) {
    const valid = ['facebook', 'instagram', 'tiktok', 'website', 'zalo'];
    return valid.includes(channel) ? channel : null;
}

/**
 * Validate purpose value
 */
function validatePurpose(purpose) {
    const valid = ['engagement', 'sales', 'awareness', 'traffic', 'leads'];
    return valid.includes(purpose) ? purpose : null;
}

/**
 * Validate post type value
 */
function validatePostType(postType) {
    const valid = ['image', 'video', 'story', 'blog', 'reel'];
    return valid.includes(postType) ? postType : null;
}

/**
 * Generate marketing plan with AI
 * @param {Object} input - Marketing plan input
 * @param {string|null} brandContext - Brand context from AI Settings
 * @param {string} modelName - Gemini model name
 * @returns {Promise<Array>} Generated posts array
 */
async function generateMarketingPlan(input, brandContext = null, modelName = 'gemini-2.0-flash') {
    try {
        // Build prompt
        const basePrompt = buildMarketingPlanPrompt(input);
        const finalPrompt = injectBrandContextToPrompt(basePrompt, brandContext);

        // Get model and generate
        const model = getModel('TEXT', modelName);
        const result = await model.generateContent(finalPrompt);
        const responseText = result.response.text();

        // Parse response
        const posts = parseMarketingPlanResponse(responseText, input);

        return posts;
    } catch (error) {
        console.error('Generate marketing plan error:', error);
        throw error;
    }
}

module.exports = {
    generateMarketingPlan,
    buildMarketingPlanPrompt,
    parseMarketingPlanResponse
};
