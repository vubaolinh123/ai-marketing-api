/**
 * Marketing Plan Service
 * AI-powered content calendar generation using Gemini
 */

const { getModel, parseJsonResponse } = require('./gemini.config');
const { injectBrandContextToPrompt } = require('./brandContext.service');
const { composePromptBlocks } = require('./prompt-modules/shared/composer');
const { buildCampaignThinkingBlock, normalizeCampaignThinking } = require('./prompt-modules/marketing/campaignThinking.module');
const { logPromptDebug } = require('../../utils/promptDebug');

const VALID_CHANNELS = ['facebook', 'instagram', 'tiktok', 'website', 'zalo'];
const VALID_PURPOSES = ['engagement', 'sales', 'awareness', 'traffic', 'leads'];
const VALID_POST_TYPES = ['image', 'video', 'story', 'blog', 'reel'];

function getGoalLabel(goal) {
    switch (goal) {
        case 'engagement': return 'Tăng tương tác';
        case 'sales': return 'Bán hàng';
        case 'awareness': return 'Nhận diện thương hiệu';
        case 'traffic': return 'Tăng traffic website';
        case 'leads': return 'Thu thập leads';
        default: return goal;
    }
}

function getChannelLabel(channel) {
    switch (channel) {
        case 'facebook': return 'Facebook';
        case 'instagram': return 'Instagram';
        case 'tiktok': return 'TikTok';
        case 'website': return 'Website/Blog';
        case 'zalo': return 'Zalo';
        default: return channel;
    }
}

/**
 * Build prompt for marketing plan generation
 * @param {Object} input - Marketing plan input data
 * @returns {string} Formatted prompt
 */
function buildMarketingPlanPrompt(input) {
    const goalsText = input.goals?.length > 0
        ? input.goals.map(getGoalLabel).join(', ')
        : 'Tăng tương tác';

    const channelsText = input.channels?.map(getChannelLabel).join(', ') || 'Facebook';
    const { block: campaignThinkingBlock } = buildCampaignThinkingBlock(input);

    return composePromptBlocks([
        'Bạn là chuyên gia Marketing với 10+ năm kinh nghiệm lên kế hoạch content cho social media.',
        `## THÔNG TIN CHIẾN DỊCH
- **Tên chiến dịch:** ${input.campaignName}
- **Thời gian:** từ ${input.startDate} đến ${input.endDate}
- **Số bài/tuần:** ${input.postsPerWeek} bài
- **Khung giờ đăng ưu tiên:** ${input.postTimes?.join(', ') || '18:00'}
- **Chủ đề nội dung:** ${input.topics?.join(', ') || 'Nội dung chung'}
- **Mục tiêu:** ${goalsText}
- **Kênh đăng:** ${channelsText}
${input.notes ? `- **Yêu cầu đặc biệt:** ${input.notes}` : ''}`,
        campaignThinkingBlock,
        `## NHIỆM VỤ
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
6. Nếu có brand setup: bắt buộc áp dụng customerTerm + brandPronoun, phản ánh product strengths/product groups, tone/contextDescriptions, và resource insights khi lên ý tưởng nội dung

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

CHỈ TRẢ VỀ JSON ARRAY, KHÔNG CÓ GÌ KHÁC.`
    ]);
}

function buildMonthlyStrategyPrompt(input) {
    const goalsText = input.goals?.length > 0
        ? input.goals.map(getGoalLabel).join(', ')
        : 'Tăng trưởng cân bằng';
    const channelsText = input.channels?.length > 0
        ? input.channels.map(getChannelLabel).join(', ')
        : 'Facebook, Instagram';
    const { block: campaignThinkingBlock } = buildCampaignThinkingBlock(input);

    return composePromptBlocks([
        'Bạn là chiến lược gia marketing tăng trưởng theo tháng.',
        `## INPUT
- Tên chiến dịch: ${input.campaignName || '(chưa có)'}
- Khoảng thời gian: ${input.startDate || '(chưa có)'} đến ${input.endDate || '(chưa có)'}
- Chủ đề hiện có: ${input.topics?.join(', ') || '(chưa có)'}
- Mục tiêu hiện có: ${goalsText}
- Kênh hiện có: ${channelsText}
${input.notes ? `- Ghi chú: ${input.notes}` : ''}`,
        campaignThinkingBlock,
        `## NHIỆM VỤ
Đề xuất chiến lược nội dung/thực thi cho 1 tháng theo hướng khả thi, rõ ưu tiên và dễ triển khai.

## OUTPUT FORMAT
Trả về CHÍNH XÁC một JSON object (không markdown, không giải thích):
{
  "concept": "big idea cho tháng",
  "contentPillars": ["pillar 1", "pillar 2", "pillar 3"],
  "topicMix": {
    "educational": "%",
    "engagement": "%",
    "conversion": "%"
  },
  "recommendedChannels": ["facebook|instagram|tiktok|website|zalo"],
  "recommendedGoals": ["engagement|sales|awareness|traffic|leads"],
  "weeklyFramework": [
    { "week": "week 1", "focus": "...", "sampleExecution": ["..."] }
  ],
  "rationale": "lý do chiến lược phù hợp với bối cảnh"
}

CHỈ TRẢ VỀ JSON OBJECT, KHÔNG CÓ GÌ KHÁC.`
    ]);
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
    return VALID_CHANNELS.includes(channel) ? channel : null;
}

/**
 * Validate purpose value
 */
function validatePurpose(purpose) {
    return VALID_PURPOSES.includes(purpose) ? purpose : null;
}

/**
 * Validate post type value
 */
function validatePostType(postType) {
    return VALID_POST_TYPES.includes(postType) ? postType : null;
}

function parseMonthlyStrategyResponse(responseText, input) {
    let cleanText = String(responseText || '')
        .replace(/```json\n?/gi, '')
        .replace(/```\n?/gi, '')
        .trim();

    const parsed = parseJsonResponse(cleanText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Không parse được JSON object chiến lược');
    }

    const normalizedCampaignThinking = normalizeCampaignThinking(input);
    const defaultConcept = normalizedCampaignThinking.monthlyFocus
        ? `Chiến lược tháng tập trung vào ${normalizedCampaignThinking.monthlyFocus}`
        : `Chiến lược tháng cho ${input.campaignName || 'doanh nghiệp'}`;

    const recommendedChannels = Array.isArray(parsed.recommendedChannels)
        ? parsed.recommendedChannels.map(validateChannel).filter(Boolean)
        : [];
    const recommendedGoals = Array.isArray(parsed.recommendedGoals)
        ? parsed.recommendedGoals.map(validatePurpose).filter(Boolean)
        : [];

    const fallbackPillars = Array.isArray(input.topics) && input.topics.length > 0
        ? input.topics.slice(0, 3)
        : ['Giá trị sản phẩm/dịch vụ', 'Niềm tin thương hiệu', 'Chuyển đổi'];

    const weeklyFramework = Array.isArray(parsed.weeklyFramework) && parsed.weeklyFramework.length > 0
        ? parsed.weeklyFramework
        : [
            { week: 'week 1', focus: 'Thu hút chú ý', sampleExecution: ['Nội dung hook + insight'] },
            { week: 'week 2', focus: 'Giáo dục thị trường', sampleExecution: ['Case/mini guide'] },
            { week: 'week 3', focus: 'Gia tăng tin tưởng', sampleExecution: ['Chứng thực/UGC'] },
            { week: 'week 4', focus: 'Chuyển đổi', sampleExecution: ['Ưu đãi + CTA'] }
        ];

    return {
        concept: typeof parsed.concept === 'string' && parsed.concept.trim()
            ? parsed.concept.trim()
            : defaultConcept,
        contentPillars: Array.isArray(parsed.contentPillars) && parsed.contentPillars.length > 0
            ? parsed.contentPillars.filter(Boolean).slice(0, 8)
            : fallbackPillars,
        topicMix: parsed.topicMix && typeof parsed.topicMix === 'object' && !Array.isArray(parsed.topicMix)
            ? parsed.topicMix
            : {
                educational: '40%',
                engagement: '35%',
                conversion: '25%'
            },
        recommendedChannels: recommendedChannels.length > 0
            ? recommendedChannels
            : (Array.isArray(input.channels) && input.channels.length > 0 ? input.channels.map(validateChannel).filter(Boolean) : ['facebook']),
        recommendedGoals: recommendedGoals.length > 0
            ? recommendedGoals
            : (Array.isArray(input.goals) && input.goals.length > 0 ? input.goals.map(validatePurpose).filter(Boolean) : ['engagement']),
        weeklyFramework,
        rationale: typeof parsed.rationale === 'string' && parsed.rationale.trim()
            ? parsed.rationale.trim()
            : 'Chiến lược cân bằng giữa nhận diện, tương tác và chuyển đổi dựa trên dữ liệu đầu vào hiện có.'
    };
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

        logPromptDebug({
            tool: 'marketing',
            step: 'prompt-built',
            data: {
                modelName,
                promptPreview: finalPrompt,
                input
            }
        });

        // Get model and generate
        const model = getModel('TEXT', modelName);
        const result = await model.generateContent(finalPrompt);
        const responseText = result.response.text();

        logPromptDebug({
            tool: 'marketing',
            step: 'ai-response',
            data: {
                modelName,
                responsePreview: responseText
            }
        });

        // Parse response
        const posts = parseMarketingPlanResponse(responseText, input);

        return posts;
    } catch (error) {
        logPromptDebug({
            tool: 'marketing',
            step: 'ai-response-error',
            data: {
                modelName,
                message: error?.message,
                stack: error?.stack
            }
        });
        console.error('Generate marketing plan error:', error);
        throw error;
    }
}

/**
 * Generate monthly strategy suggestion
 * @param {Object} input
 * @param {string|null} brandContext
 * @param {string} modelName
 * @returns {Promise<Object>}
 */
async function generateMonthlyStrategy(input, brandContext = null, modelName = 'gemini-2.0-flash') {
    try {
        const basePrompt = buildMonthlyStrategyPrompt(input);
        const finalPrompt = injectBrandContextToPrompt(basePrompt, brandContext);

        logPromptDebug({
            tool: 'marketing',
            step: 'prompt-built',
            data: {
                mode: 'monthly-strategy',
                modelName,
                promptPreview: finalPrompt,
                input
            }
        });

        const model = getModel('TEXT', modelName);
        const result = await model.generateContent(finalPrompt);
        const responseText = result.response.text();

        logPromptDebug({
            tool: 'marketing',
            step: 'ai-response',
            data: {
                mode: 'monthly-strategy',
                modelName,
                responsePreview: responseText
            }
        });

        return parseMonthlyStrategyResponse(responseText, input);
    } catch (error) {
        logPromptDebug({
            tool: 'marketing',
            step: 'ai-response-error',
            data: {
                mode: 'monthly-strategy',
                modelName,
                message: error?.message,
                stack: error?.stack
            }
        });
        console.error('Generate monthly strategy error:', error);
        throw error;
    }
}

module.exports = {
    generateMarketingPlan,
    generateMonthlyStrategy,
    buildMarketingPlanPrompt,
    parseMarketingPlanResponse,
    buildMonthlyStrategyPrompt,
    parseMonthlyStrategyResponse
};
