/**
 * Brand Context Service
 * Builds brand context from AI Settings for prompt enhancement
 * 
 * This service is designed to be reusable across all AI generation services.
 * Import and use injectBrandContextToPrompt() to add brand context to any prompt.
 */

/**
 * Build brand context string from AI Settings
 * @param {Object} aiSettings - AI Settings object from database
 * @returns {string|null} Formatted brand context or null if no settings
 */
function buildBrandContext(aiSettings) {
    if (!aiSettings) return null;
    
    const sections = [];
    
    // ==========================================
    // LOGO & BRAND IDENTITY
    // ==========================================
    if (aiSettings.logo?.brandName) {
        sections.push(`**Tên thương hiệu:** ${aiSettings.logo.brandName}`);
    }
    if (aiSettings.logo?.brandIdentity) {
        sections.push(`**Nhận diện thương hiệu:** ${aiSettings.logo.brandIdentity}`);
    }
    if (aiSettings.logo?.resourceLinks?.length > 0) {
        const links = aiSettings.logo.resourceLinks
            .filter(link => link.label && link.url)
            .map(link => `  - ${link.label}: ${link.url}`)
            .join('\n');
        if (links) {
            sections.push(`**Tài nguyên tham khảo:**\n${links}`);
        }
    }
    
    // ==========================================
    // BẢNG MÀU THƯƠNG HIỆU
    // ==========================================
    if (aiSettings.colors) {
        const colorInfo = [];
        if (aiSettings.colors.primaryColor) {
            colorInfo.push(`Màu chính: ${aiSettings.colors.primaryColor}`);
        }
        if (aiSettings.colors.backgroundColor) {
            colorInfo.push(`Màu nền: ${aiSettings.colors.backgroundColor}`);
        }
        if (aiSettings.colors.accentColor) {
            colorInfo.push(`Màu nhấn: ${aiSettings.colors.accentColor}`);
        }
        if (colorInfo.length > 0) {
            sections.push(`**Bảng màu thương hiệu:** ${colorInfo.join(', ')}`);
        }
    }
    
    // ==========================================
    // NGÔN NGỮ & TỪ KHÓA
    // ==========================================
    if (aiSettings.language?.keywords?.length > 0) {
        sections.push(`**Từ khóa thương hiệu:** ${aiSettings.language.keywords.join(', ')}`);
    }
    if (aiSettings.language?.customerTerm) {
        sections.push(`**Cách xưng hô khách hàng:** ${aiSettings.language.customerTerm}`);
    }
    
    // ==========================================
    // GIỌNG ĐIỆU THƯƠNG HIỆU
    // ==========================================
    if (aiSettings.tone?.overallTone?.length > 0) {
        sections.push(`**Tone giọng điệu:** ${aiSettings.tone.overallTone.join(', ')}`);
    }
    if (aiSettings.tone?.contextDescriptions?.length > 0) {
        const contexts = aiSettings.tone.contextDescriptions
            .filter(ctx => ctx.context && ctx.description)
            .map(ctx => `  - ${ctx.context}: ${ctx.description}`)
            .join('\n');
        if (contexts) {
            sections.push(`**Ngữ cảnh và cách diễn đạt:**\n${contexts}`);
        }
    }
    
    // ==========================================
    // SẢN PHẨM / DỊCH VỤ
    // ==========================================
    if (aiSettings.product?.productGroups?.length > 0) {
        sections.push(`**Nhóm sản phẩm/dịch vụ:** ${aiSettings.product.productGroups.join(', ')}`);
    }
    if (aiSettings.product?.strengths) {
        sections.push(`**Điểm mạnh:** ${aiSettings.product.strengths}`);
    }
    if (aiSettings.product?.suitableFor?.length > 0) {
        sections.push(`**Phù hợp với:** ${aiSettings.product.suitableFor.join(', ')}`);
    }
    
    return sections.length > 0 ? sections.join('\n') : null;
}

/**
 * Check if AI Settings has meaningful brand data
 * @param {Object} aiSettings - AI Settings object
 * @returns {boolean} True if has brand data
 */
function hasBrandData(aiSettings) {
    if (!aiSettings) return false;
    
    return !!(
        aiSettings.logo?.brandName ||
        aiSettings.logo?.brandIdentity ||
        aiSettings.language?.keywords?.length > 0 ||
        aiSettings.tone?.overallTone?.length > 0 ||
        aiSettings.product?.productGroups?.length > 0 ||
        aiSettings.product?.strengths ||
        aiSettings.colors?.primaryColor
    );
}

/**
 * Inject brand context into any prompt
 * This is a reusable helper for all AI generation services.
 * 
 * @param {string} basePrompt - The original prompt
 * @param {string|null} brandContext - Brand context string from buildBrandContext()
 * @returns {string} Prompt with brand context injected
 * 
 * @example
 * const { buildBrandContext, injectBrandContextToPrompt } = require('./brandContext.service');
 * const brandContext = buildBrandContext(aiSettings);
 * const enhancedPrompt = injectBrandContextToPrompt(myPrompt, brandContext);
 */
function injectBrandContextToPrompt(basePrompt, brandContext) {
    if (!brandContext) return basePrompt;
    
    const brandSection = `

## THÔNG TIN THƯƠNG HIỆU (Bắt buộc tuân thủ)
${brandContext}

### Hướng dẫn sử dụng thông tin thương hiệu:
- Sử dụng CHÍNH XÁC tên thương hiệu đã cung cấp, KHÔNG dùng placeholder như [Tên thương hiệu] hoặc [Tên Nhà Hàng]
- Áp dụng tone giọng điệu đã định nghĩa xuyên suốt bài viết
- Xưng hô khách hàng theo cách đã thiết lập
- Lồng ghép từ khóa thương hiệu một cách tự nhiên vào nội dung
- Nhấn mạnh điểm mạnh sản phẩm/dịch vụ khi phù hợp ngữ cảnh
- KHÔNG bịa thêm thông tin không có trong dữ liệu thương hiệu`;

    return basePrompt + brandSection;
}

module.exports = {
    buildBrandContext,
    hasBrandData,
    injectBrandContextToPrompt
};
