/**
 * Video Script Service
 * Generates video scripts using Gemini AI
 */

const { getModel, parseJsonResponse } = require('./gemini.config');
const { injectBrandContextToPrompt } = require('./brandContext.service');
const { logPromptDebug } = require('../../utils/promptDebug');

// Size labels for prompts
const SIZE_LABELS = {
    'vertical': 'Dọc (Reels/TikTok 9:16)',
    'horizontal': 'Ngang (YouTube 16:9)',
    'square': 'Vuông (Facebook/Instagram 1:1)'
};

// Shot type descriptions
const SHOT_TYPES = {
    'goc_trung': 'Góc trung (medium shot)',
    'can_canh': 'Cận cảnh (close-up)',
    'goc_rong': 'Góc rộng (wide shot)',
    'overlay': 'Overlay (đồ họa/text)'
};

function normalizeNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    if (typeof min === 'number' && parsed < min) return min;
    if (typeof max === 'number' && parsed > max) return max;
    return parsed;
}

function normalizeText(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
}

function humanizeKey(key = '') {
    return String(key)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim();
}

function flattenToReadableText(value) {
    if (typeof value === 'string') {
        return value.trim();
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => flattenToReadableText(item))
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    if (value && typeof value === 'object') {
        return Object.entries(value)
            .map(([key, nestedValue]) => {
                const nestedText = flattenToReadableText(nestedValue);
                if (!nestedText) return '';
                return `${humanizeKey(key)}: ${nestedText}`;
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    return '';
}

function normalizeIdeaField(value, fallback = '') {
    const flattened = flattenToReadableText(value);
    return normalizeText(flattened, fallback);
}

function normalizeGeneratedIdea(parsed = {}) {
    const normalized = {
        hook: normalizeIdeaField(parsed?.hook, 'Mở đầu gây chú ý trong 3-5 giây đầu.'),
        mainContent: normalizeIdeaField(parsed?.mainContent, 'Nội dung chính làm nổi bật lợi ích và giá trị cốt lõi.'),
        callToAction: normalizeIdeaField(parsed?.callToAction, 'Kêu gọi hành động rõ ràng, phù hợp mục tiêu video.'),
        mood: normalizeIdeaField(parsed?.mood, 'Phong cách tích cực, phù hợp định vị thương hiệu.'),
        summary: normalizeIdeaField(parsed?.summary)
    };

    if (!normalized.summary) {
        normalized.summary = normalizeText(
            [normalized.hook, normalized.mainContent, normalized.callToAction]
                .filter(Boolean)
                .join(' '),
            'Ý tưởng video marketing theo yêu cầu.'
        );
    }

    return {
        ...parsed,
        ...normalized
    };
}

function normalizeScriptInput(input = {}) {
    return {
        title: normalizeText(input.title),
        duration: normalizeText(input.duration, 'không xác định'),
        sceneCount: normalizeNumber(input.sceneCount, 6, 2, 30),
        size: normalizeText(input.size),
        hasVoiceOver: input.hasVoiceOver !== false,
        otherRequirements: normalizeText(input.otherRequirements),
        ideaMode: normalizeText(input.ideaMode, 'ai'),
        customIdea: normalizeText(input.customIdea),
        videoGoal: normalizeText(input.videoGoal),
        targetAudience: normalizeText(input.targetAudience),
        featuredProductService: normalizeText(input.featuredProductService),
        selectedConceptTitle: normalizeText(input.selectedConceptTitle)
    };
}

function normalizeConcept(concept = {}, index = 0) {
    return {
        title: normalizeText(concept.title, `Concept ${index + 1}`),
        hook: normalizeText(concept.hook),
        coreMessage: normalizeText(concept.coreMessage),
        visualDirection: normalizeText(concept.visualDirection),
        cta: normalizeText(concept.cta),
        mood: normalizeText(concept.mood)
    };
}

function buildVideoScriptBasePrompt(input) {
    const sizeLabel = SIZE_LABELS[input.size] || input.size || 'không xác định';

    return `Bạn là chuyên gia viết kịch bản video marketing chuyên nghiệp. Hãy tạo một kịch bản video hoàn chỉnh.

## THÔNG TIN VIDEO
- **Tiêu đề/Chủ đề:** ${input.title}
- **Thời lượng dự kiến:** ${input.duration}
- **Số cảnh yêu cầu:** ${input.sceneCount} cảnh
- **Kích thước video:** ${sizeLabel}
- **Có Voice Over:** ${input.hasVoiceOver ? 'Có' : 'Không'}
- **Mục tiêu video:** ${input.videoGoal || '(không cung cấp)'}
- **Tệp khán giả mục tiêu:** ${input.targetAudience || '(không cung cấp)'}
- **Sản phẩm/dịch vụ nổi bật:** ${input.featuredProductService || '(không cung cấp)'}
- **Idea mode:** ${input.ideaMode || 'ai'}
${input.selectedConceptTitle ? `- **Concept đã chọn:** ${input.selectedConceptTitle}` : ''}
${input.customIdea ? `- **Ý tưởng tóm tắt:** ${input.customIdea}` : ''}
${input.otherRequirements ? `- **Yêu cầu khác:** ${input.otherRequirements}` : ''}

## YÊU CẦU
1. Tạo kịch bản chi tiết với ĐÚNG ${input.sceneCount} cảnh quay
2. Mỗi cảnh cần có: địa điểm, loại góc quay, mô tả hành động, voice over (nếu có), nguồn (quay mới/dựng), ghi chú
3. Loại góc quay chỉ được chọn từ: goc_trung, can_canh, goc_rong, overlay
4. Kịch bản phải có hook mạnh ở cảnh đầu và CTA rõ ở cuối
5. Kịch bản phải bám sát mục tiêu video, đúng đối tượng khán giả và làm nổi bật sản phẩm/dịch vụ chính`;
}

function buildVideoScriptJsonInstruction(sceneCount) {
    return `

## FORMAT JSON TRẢ VỀ
{
    "summary": "Tóm tắt ý tưởng kịch bản (2-3 câu)",
    "scenes": [
        {
            "sceneNumber": 1,
            "location": "Địa điểm quay",
            "shotType": "goc_trung hoặc can_canh hoặc goc_rong hoặc overlay",
            "description": "Mô tả chi tiết hành động trong cảnh",
            "voiceOver": "Lời thoại/voice over nếu có",
            "source": "Quay mới hoặc Dựng hoặc Stock",
            "note": "Ghi chú thêm nếu có"
        }
    ]
}

QUAN TRỌNG:
- Phải tạo ĐÚNG ${sceneCount} cảnh, không nhiều hơn, không ít hơn.
- Trường scenes phải là mảng và sceneNumber tăng tuần tự từ 1.

Chỉ trả về JSON hợp lệ, không có text thêm.`;
}

function normalizeGeneratedScript(parsed, expectedSceneCount) {
    const scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];

    if (scenes.length !== expectedSceneCount) {
        throw new Error(`Invalid scenes count from Gemini. Expected ${expectedSceneCount}, got ${scenes.length}`);
    }

    const normalizedScenes = scenes.map((scene, index) => ({
        sceneNumber: index + 1,
        location: normalizeText(scene?.location),
        shotType: SHOT_TYPES[scene?.shotType] ? scene.shotType : 'goc_trung',
        description: normalizeText(scene?.description, `Cảnh ${index + 1}`),
        voiceOver: normalizeText(scene?.voiceOver),
        source: normalizeText(scene?.source, 'Quay mới'),
        note: normalizeText(scene?.note)
    }));

    return {
        summary: normalizeText(parsed?.summary, 'Kịch bản video marketing theo yêu cầu.'),
        scenes: normalizedScenes
    };
}

function buildIdeaBasePrompt({ title, duration, sceneCount, videoGoal, targetAudience, featuredProductService, selectedConceptTitle }) {
    return `Bạn là chuyên gia sáng tạo content video marketing hàng đầu. Nhiệm vụ của bạn là tạo một ý tưởng kịch bản video ĐỘC ĐÁO và CHI TIẾT.

## THÔNG TIN CHIẾN DỊCH
- **Chủ đề chính:** ${title}
- **Thời lượng dự kiến:** ${duration || 'không xác định'}
- **Số lượng cảnh planned:** ${sceneCount || 6} cảnh
- **Mục tiêu video:** ${videoGoal || '(không cung cấp)'}
- **Khán giả mục tiêu:** ${targetAudience || '(không cung cấp)'}
- **Sản phẩm/dịch vụ nổi bật:** ${featuredProductService || '(không cung cấp)'}
${selectedConceptTitle ? `- **Concept đã chọn:** ${selectedConceptTitle}` : ''}

## QUY TẮC CẦN TUÂN THỦ (QUAN TRỌNG):
1. Nếu thời lượng > 1 phút hoặc số cảnh > 10, nội dung gợi ý phải cực kỳ chi tiết, phân chia rõ các giai đoạn.
2. Mỗi cảnh phải đóng góp vào storyline hoàn chỉnh, mô tả rõ hình ảnh và lời thoại.
3. Hook 3-5 giây đầu phải thật sự gây chú ý.
4. CTA phải tinh tế nhưng quyết liệt, gắn với mục tiêu thương hiệu.`;
}

function buildIdeaJsonInstruction(duration, sceneCount) {
    return `

## FORMAT JSON TRẢ VỀ (BẮT BUỘC)
{
    "hook": "Mô tả chi tiết hành động hoặc câu nói gây chú ý mạnh mẽ trong 3-5 giây đầu.",
    "mainContent": "Mô tả chi tiết nội dung video theo dòng thời gian.",
    "callToAction": "Câu chốt hạ và hành động mong muốn.",
    "mood": "Mô tả phong cách thị giác và âm nhạc.",
    "summary": "Bản tóm tắt kịch bản toàn diện (4-6 câu), thể hiện logic giữa số cảnh (${sceneCount}) và thời lượng (${duration})."
}

Chỉ trả về JSON hợp lệ, không có text thêm.`;
}

function buildConceptSuggestionPrompt({
    title,
    duration,
    sceneCount,
    videoGoal,
    targetAudience,
    featuredProductService,
    conceptCount
}) {
    return `Bạn là Creative Director chuyên lên concept video marketing chuyển đổi cao.

## INPUT
- Chủ đề video: ${title}
- Thời lượng dự kiến: ${duration || 'không xác định'}
- Số cảnh dự kiến: ${sceneCount || 6}
- Mục tiêu video: ${videoGoal}
- Khán giả mục tiêu: ${targetAudience}
- Sản phẩm/dịch vụ nổi bật: ${featuredProductService}
- Số concept cần gợi ý: ${conceptCount}

## NHIỆM VỤ
Đề xuất ${conceptCount} concept video khác nhau nhưng cùng bám sát mục tiêu. Mỗi concept phải khả thi để phát triển thành script chi tiết.

## OUTPUT JSON (CHỈ JSON, KHÔNG GIẢI THÍCH)
{
  "summary": "Tổng quan nhanh về định hướng concept",
  "recommendedApproach": "Đề xuất hướng nên ưu tiên và lý do",
  "concepts": [
    {
      "title": "Tên concept",
      "hook": "Mồi câu mở đầu",
      "coreMessage": "Thông điệp cốt lõi",
      "visualDirection": "Định hướng hình ảnh/quay dựng",
      "cta": "CTA đề xuất",
      "mood": "Mood/tone"
    }
  ]
}

QUY TẮC:
- concepts phải có đúng ${conceptCount} phần tử.
- Ngắn gọn, cụ thể, không chung chung.
- Chỉ trả về JSON hợp lệ.`;
}

/**
 * Generate a complete video script
 * @param {Object} params - Generation parameters
 * @param {Object} params.input - User input from form
 * @param {number} params.input.sceneCount - Number of scenes (user configurable)
 * @param {string} params.input.duration - Video duration (user configurable, e.g. "3 phút")
 * @param {string|null} params.brandContext - Brand context from AI Settings
 * @returns {Promise<Object>} Generated script with summary and scenes
 */
async function generateVideoScript({ input, brandContext = null, modelName = null }) {
    const model = getModel('TEXT', modelName);
    const normalizedInput = normalizeScriptInput(input);

    const basePrompt = buildVideoScriptBasePrompt(normalizedInput);

    // Inject brand context if available
    const prompt = injectBrandContextToPrompt(basePrompt, brandContext);
    const finalPrompt = prompt + buildVideoScriptJsonInstruction(normalizedInput.sceneCount);

    logPromptDebug({
        tool: 'video',
        step: 'prompt-built',
        data: {
            mode: 'generate-script',
            modelName,
            promptPreview: finalPrompt,
            input: normalizedInput
        }
    });

    try {
        const result = await model.generateContent(finalPrompt);
        const response = result.response;
        const text = response.text();

        logPromptDebug({
            tool: 'video',
            step: 'ai-response',
            data: {
                mode: 'generate-script',
                modelName,
                responsePreview: text
            }
        });
        
        const parsed = parseJsonResponse(text);
        if (parsed && parsed.scenes && Array.isArray(parsed.scenes)) {
            return normalizeGeneratedScript(parsed, normalizedInput.sceneCount);
        }
        
        throw new Error('Invalid response format from Gemini');
    } catch (error) {
        logPromptDebug({
            tool: 'video',
            step: 'ai-response-error',
            data: {
                mode: 'generate-script',
                modelName,
                message: error?.message,
                stack: error?.stack
            }
        });
        console.error('videoScript.service generateVideoScript error:', error);
        throw error;
    }
}

/**
 * Generate a video idea based on brand context and video parameters
 * @param {Object} params - Generation parameters
 * @param {string} params.title - Video topic (required)
 * @param {string} params.duration - Video duration
 * @param {number} params.sceneCount - Number of scenes
 * @param {string} params.videoGoal - Video goal
 * @param {string} params.targetAudience - Target audience
 * @param {string} params.featuredProductService - Featured product/service
 * @param {string} params.selectedConceptTitle - Optional selected concept title
 * @param {string|null} params.brandContext - Brand context from AI Settings
 * @returns {Promise<Object>} Generated idea with structured format
 */
async function generateRandomIdea({
    title,
    duration,
    sceneCount,
    videoGoal,
    targetAudience,
    featuredProductService,
    selectedConceptTitle,
    brandContext = null,
    modelName = null
}) {
    const model = getModel('TEXT', modelName);
    const normalizedSceneCount = normalizeNumber(sceneCount, 6, 2, 30);

    const basePrompt = buildIdeaBasePrompt({
        title,
        duration,
        sceneCount: normalizedSceneCount,
        videoGoal,
        targetAudience,
        featuredProductService,
        selectedConceptTitle
    });

    // Inject brand context if available
    const prompt = injectBrandContextToPrompt(basePrompt, brandContext);
    const finalPrompt = prompt + buildIdeaJsonInstruction(duration, normalizedSceneCount);

    logPromptDebug({
        tool: 'video',
        step: 'prompt-built',
        data: {
            mode: 'generate-idea',
            modelName,
            promptPreview: finalPrompt,
            input: {
                title,
                duration,
                sceneCount: normalizedSceneCount,
                videoGoal,
                targetAudience,
                featuredProductService,
                selectedConceptTitle
            }
        }
    });

    try {
        const result = await model.generateContent(finalPrompt);
        const response = result.response;
        const text = response.text();

        logPromptDebug({
            tool: 'video',
            step: 'ai-response',
            data: {
                mode: 'generate-idea',
                modelName,
                responsePreview: text
            }
        });
        
        const parsed = parseJsonResponse(text);
        if (parsed && typeof parsed === 'object') {
            return normalizeGeneratedIdea(parsed);
        }
        
        throw new Error('Invalid response format from Gemini');
    } catch (error) {
        logPromptDebug({
            tool: 'video',
            step: 'ai-response-error',
            data: {
                mode: 'generate-idea',
                modelName,
                message: error?.message,
                stack: error?.stack
            }
        });
        console.error('videoScript.service generateRandomIdea error:', error);
        throw error;
    }
}

/**
 * Suggest multiple video concepts
 * @param {Object} params
 * @returns {Promise<{concepts: Array, recommendedApproach?: string, summary?: string}>}
 */
async function suggestVideoConcepts({
    title,
    duration,
    sceneCount,
    videoGoal,
    targetAudience,
    featuredProductService,
    conceptCount = 5,
    brandContext = null,
    modelName = null
}) {
    const model = getModel('TEXT', modelName);
    const safeConceptCount = normalizeNumber(conceptCount, 5, 3, 5);
    const safeSceneCount = normalizeNumber(sceneCount, 6, 2, 30);

    const basePrompt = buildConceptSuggestionPrompt({
        title: normalizeText(title),
        duration: normalizeText(duration),
        sceneCount: safeSceneCount,
        videoGoal: normalizeText(videoGoal),
        targetAudience: normalizeText(targetAudience),
        featuredProductService: normalizeText(featuredProductService),
        conceptCount: safeConceptCount
    });

    const prompt = injectBrandContextToPrompt(basePrompt, brandContext);

    logPromptDebug({
        tool: 'video',
        step: 'prompt-built',
        data: {
            mode: 'suggest-concepts',
            modelName,
            promptPreview: prompt,
            input: {
                title,
                duration,
                sceneCount: safeSceneCount,
                videoGoal,
                targetAudience,
                featuredProductService,
                conceptCount: safeConceptCount
            }
        }
    });

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();

        logPromptDebug({
            tool: 'video',
            step: 'ai-response',
            data: {
                mode: 'suggest-concepts',
                modelName,
                responsePreview: text
            }
        });
        const parsed = parseJsonResponse(text);

        if (!parsed || !Array.isArray(parsed.concepts)) {
            throw new Error('Invalid concept suggestion response format from Gemini');
        }

        const concepts = parsed.concepts
            .slice(0, safeConceptCount)
            .map((item, idx) => normalizeConcept(item, idx));

        if (concepts.length < 3) {
            throw new Error('Gemini returned too few concepts');
        }

        return {
            concepts,
            recommendedApproach: normalizeText(parsed.recommendedApproach),
            summary: normalizeText(parsed.summary)
        };
    } catch (error) {
        logPromptDebug({
            tool: 'video',
            step: 'ai-response-error',
            data: {
                mode: 'suggest-concepts',
                modelName,
                message: error?.message,
                stack: error?.stack
            }
        });
        console.error('videoScript.service suggestVideoConcepts error:', error);
        throw error;
    }
}

module.exports = {
    generateVideoScript,
    generateRandomIdea,
    suggestVideoConcepts,
    SIZE_LABELS,
    SHOT_TYPES
};
