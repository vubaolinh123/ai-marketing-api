/**
 * Video Script Service
 * Generates video scripts using Gemini AI
 */

const { getModel, parseJsonResponse } = require('./gemini.config');
const { injectBrandContextToPrompt } = require('./brandContext.service');

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

/**
 * Generate a complete video script
 * @param {Object} params - Generation parameters
 * @param {Object} params.input - User input from form
 * @param {number} params.input.sceneCount - Number of scenes (user configurable)
 * @param {string} params.input.duration - Video duration (user configurable, e.g. "3 phút")
 * @param {string|null} params.brandContext - Brand context from AI Settings
 * @returns {Promise<Object>} Generated script with summary and scenes
 */
async function generateVideoScript({ input, brandContext = null }) {
    const model = getModel('TEXT');
    
    const sizeLabel = SIZE_LABELS[input.size] || input.size || 'không xác định';
    const sceneCount = input.sceneCount || 6; // Default 6 scenes if not specified
    const duration = input.duration || 'không xác định';
    
    // Build base prompt
    let basePrompt = `Bạn là chuyên gia viết kịch bản video marketing chuyên nghiệp. Hãy tạo một kịch bản video hoàn chỉnh.

## THÔNG TIN VIDEO
- **Tiêu đề/Chủ đề:** ${input.title}
- **Thời lượng dự kiến:** ${duration}
- **Số cảnh yêu cầu:** ${sceneCount} cảnh
- **Kích thước video:** ${sizeLabel}
- **Có Voice Over:** ${input.hasVoiceOver ? 'Có' : 'Không'}
${input.customIdea ? `- **Ý tưởng tóm tắt:** ${input.customIdea}` : ''}
${input.otherRequirements ? `- **Yêu cầu khác:** ${input.otherRequirements}` : ''}

## YÊU CẦU
1. Tạo kịch bản chi tiết với ĐÚNG ${sceneCount} cảnh quay
2. Mỗi cảnh cần có: địa điểm, loại góc quay, mô tả hành động, voice over (nếu có), nguồn (quay mới/dựng), ghi chú
3. Loại góc quay chỉ được chọn từ: goc_trung, can_canh, goc_rong, overlay
4. Kịch bản phải thu hút, có hook mạnh ở đầu video
5. Phân bổ nội dung phù hợp với thời lượng ${duration}`;

    // Inject brand context if available
    const prompt = injectBrandContextToPrompt(basePrompt, brandContext);
    
    // Add JSON format instruction
    const finalPrompt = prompt + `

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

QUAN TRỌNG: Phải tạo ĐÚNG ${sceneCount} cảnh, không nhiều hơn, không ít hơn.

Chỉ trả về JSON hợp lệ, không có text thêm.`;

    try {
        const result = await model.generateContent(finalPrompt);
        const response = result.response;
        const text = response.text();
        
        const parsed = parseJsonResponse(text);
        if (parsed && parsed.scenes && Array.isArray(parsed.scenes)) {
            return parsed;
        }
        
        throw new Error('Invalid response format from Gemini');
    } catch (error) {
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
 * @param {string|null} params.brandContext - Brand context from AI Settings
 * @returns {Promise<Object>} Generated idea with structured format
 */
async function generateRandomIdea({ title, duration, sceneCount, brandContext = null }) {
    const model = getModel('TEXT');
    
    let basePrompt = `Bạn là chuyên gia sáng tạo content video marketing hàng đầu. Nhiệm vụ của bạn là tạo một ý tưởng kịch bản video ĐỘC ĐÁO và CHI TIẾT.
    
    ## THÔNG TIN CHIẾN DỊCH
    - **Chủ đề chính:** ${title}
    - **Thời lượng dự kiến:** ${duration || 'không xác định'}
    - **Số lượng cảnh planned:** ${sceneCount || 6} cảnh
    
    ## QUY TẮC CẦN TUÂN THỦ (QUAN TRỌNG):
    1. **Tương quan độ dài:** Nếu thời lượng > 1 phút hoặc số cảnh > 10, nội dung gợi ý phải cực kỳ chi tiết, phân chia rõ các giai đoạn (Mở đầu, Thân bài - cao trào, Kết thúc). Không được đưa ra những gợi ý ngắn ngủi, hời hợt.
    2. **Độ sâu nội dung:** Mỗi cảnh (trong tổng số ${sceneCount || 6} cảnh) phải đóng góp vào một mạch kể chuyện (storyline) hoàn chỉnh. Hãy mô tả ý tưởng sao cho người dựng phim hoặc AI tiếp theo có thể hình dung được hình ảnh và lời thoại một cách rõ ràng nhất.
    3. **Hook (Mồi nhử):** 3-5 giây đầu phải thực sự gây đột biến. Đưa ra 1 hành động, 1 câu hỏi hoặc 1 tình huống "crazy" liên quan đến ${title}.
    4. **CTA (Kêu gọi):** Phải tinh tế nhưng quyết liệt, gắn liền với mục tiêu thương hiệu.`;

    // Inject brand context if available
    const prompt = injectBrandContextToPrompt(basePrompt, brandContext);
    
    const finalPrompt = prompt + `
    
    ## FORMAT JSON TRẢ VỀ (BẮT BUỘC)
    {
        "hook": "Mô tả chi tiết hành động hoặc câu nói gây chú ý mạnh mẽ trong 3-5 giây đầu (ví dụ: 'Bạn có biết...', hoặc cảnh quay cận cảnh món ăn đang bốc khói).",
        "mainContent": "Bản mô tả chi tiết nội dung video theo dòng thời gian. Nếu video dài (${duration}), hãy liệt kê các luận điểm chính và cách dẫn dắt câu chuyện qua từng block cảnh quay để đảm bảo người xem không bị nhàm chán.",
        "callToAction": "Câu chốt hạ và hành động mong muốn (VD: 'Click vào bio để nhận ưu đãi', 'Comment ngay cảm nhận của bạn').",
        "mood": "Mô tả phong cách thị giác và âm nhạc (VD: Cinematic, năng động, tối giản, vintage).",
        "summary": "Bản tóm tắt kịch bản toàn diện (4-6 câu). Chứa đựng toàn bộ 'linh hồn' của kịch bản, làm căn cứ để tạo kịch bản chi tiết sau này. Phải thể hiện được sự logic giữa số cảnh (${sceneCount}) và thời lượng (${duration})."
    }

    LƯU Ý: Nếu số cảnh lớn (ví dụ 12 cảnh), phần 'summary' và 'mainContent' phải cung cấp đủ 'nguyên liệu' cho 12 cảnh đó. Không được viết chung chung.

Chỉ trả về JSON hợp lệ, không có text thêm.`;

    try {
        const result = await model.generateContent(finalPrompt);
        const response = result.response;
        const text = response.text();
        
        const parsed = parseJsonResponse(text);
        if (parsed && parsed.summary) {
            return parsed;
        }
        
        throw new Error('Invalid response format from Gemini');
    } catch (error) {
        console.error('videoScript.service generateRandomIdea error:', error);
        throw error;
    }
}

module.exports = {
    generateVideoScript,
    generateRandomIdea,
    SIZE_LABELS,
    SHOT_TYPES
};
