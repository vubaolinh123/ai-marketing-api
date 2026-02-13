/**
 * Brand Context Service
 * Builds brand context from AI Settings for prompt enhancement
 * 
 * This service is designed to be reusable across all AI generation services.
 * Import and use injectBrandContextToPrompt() to add brand context to any prompt.
 */

const { normalizeBrandSetup } = require('./prompt-modules/brand/normalizeBrandSetup.module');
const { buildBrandPromptBlock } = require('./prompt-modules/brand/brandPromptBlock.module');

function pushIfExists(target, line) {
    if (line) target.push(line);
}

function listToLine(label, values = []) {
    if (!Array.isArray(values) || values.length === 0) return null;
    return `**${label}:** ${values.join(', ')}`;
}

/**
 * Build brand context string from AI Settings
 * @param {Object} aiSettings - AI Settings object from database
 * @returns {string|null} Formatted brand context or null if no settings
 */
function buildBrandContext(aiSettings) {
    if (!aiSettings) return null;

    const normalized = normalizeBrandSetup(aiSettings);
    const sections = [];

    // ==========================================
    // LOGO & BRAND IDENTITY
    // ==========================================
    pushIfExists(sections, normalized.logo.brandName ? `**Tên thương hiệu:** ${normalized.logo.brandName}` : null);
    pushIfExists(sections, normalized.logo.brandIdentity ? `**Nhận diện thương hiệu:** ${normalized.logo.brandIdentity}` : null);
    if (normalized.logo.resourceLinks.length > 0) {
        const links = normalized.logo.resourceLinks
            .map((link) => `  - ${link.label}: ${link.url}`)
            .join('\n');
        if (links) {
            sections.push(`**Tài nguyên tham khảo:**\n${links}`);
        }
    }

    // ==========================================
    // BẢNG MÀU THƯƠNG HIỆU
    // ==========================================
    const colorInfo = [];
    if (normalized.colors.primaryColor) colorInfo.push(`Màu chính: ${normalized.colors.primaryColor}`);
    if (normalized.colors.backgroundColor) colorInfo.push(`Màu nền: ${normalized.colors.backgroundColor}`);
    if (normalized.colors.accentColor) colorInfo.push(`Màu nhấn: ${normalized.colors.accentColor}`);
    if (colorInfo.length > 0) {
        sections.push(`**Bảng màu thương hiệu:** ${colorInfo.join(', ')}`);
    }

    // ==========================================
    // NGÔN NGỮ & TỪ KHÓA
    // ==========================================
    pushIfExists(sections, listToLine('Từ khóa thương hiệu', normalized.language.keywords));
    pushIfExists(sections, normalized.language.customerTerm
        ? `**Cách xưng hô khách hàng:** ${normalized.language.customerTerm}`
        : null);
    pushIfExists(sections, normalized.language.brandPronoun
        ? `**Cách xưng hô thương hiệu:** ${normalized.language.brandPronoun}`
        : null);

    // ==========================================
    // GIỌNG ĐIỆU THƯƠNG HIỆU
    // ==========================================
    pushIfExists(sections, listToLine('Tone giọng điệu', normalized.tone.overallTone));
    if (normalized.tone.contextDescriptions.length > 0) {
        const contexts = normalized.tone.contextDescriptions
            .map((ctx) => `  - ${ctx.context}: ${ctx.description}`)
            .join('\n');
        if (contexts) {
            sections.push(`**Ngữ cảnh và cách diễn đạt:**\n${contexts}`);
        }
    }

    // ==========================================
    // SẢN PHẨM / DỊCH VỤ
    // ==========================================
    pushIfExists(sections, listToLine('Nhóm sản phẩm/dịch vụ', normalized.product.productGroups));
    pushIfExists(sections, normalized.product.strengths ? `**Điểm mạnh:** ${normalized.product.strengths}` : null);
    pushIfExists(sections, listToLine('Phù hợp với', normalized.product.suitableFor));

    return sections.length > 0 ? sections.join('\n') : null;
}

/**
 * Build rich brand context string (async)
 * @param {Object} aiSettings
 * @returns {Promise<string|null>}
 */
async function buildRichBrandContext(aiSettings) {
    if (!aiSettings) return null;

    try {
        const block = await buildBrandPromptBlock(aiSettings);
        return block || buildBrandContext(aiSettings);
    } catch (error) {
        console.error('buildRichBrandContext error, fallback to sync context:', error.message);
        return buildBrandContext(aiSettings);
    }
}

/**
 * Check if AI Settings has meaningful brand data
 * @param {Object} aiSettings - AI Settings object
 * @returns {boolean} True if has brand data
 */
function hasBrandData(aiSettings) {
    if (!aiSettings) return false;

    const normalized = normalizeBrandSetup(aiSettings);

    return !!(
        normalized.logo.brandName ||
        normalized.logo.brandIdentity ||
        normalized.logo.resourceLinks.length > 0 ||
        normalized.language.keywords.length > 0 ||
        normalized.language.customerTerm ||
        normalized.language.brandPronoun ||
        normalized.tone.overallTone.length > 0 ||
        normalized.product.productGroups.length > 0 ||
        normalized.product.strengths ||
        normalized.colors.primaryColor
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
- Xưng hô khách hàng theo customerTerm và xưng hô thương hiệu theo brandPronoun nếu có
- Lồng ghép từ khóa thương hiệu một cách tự nhiên vào nội dung
- Tận dụng productGroups và strengths để làm rõ lợi thế sản phẩm/dịch vụ
- Ưu tiên contextDescriptions theo từng ngữ cảnh thể hiện thông điệp
- Nếu có resource insights, dùng làm nguồn tham chiếu thị giác/ngôn ngữ nhất quán
- KHÔNG bịa thêm thông tin không có trong dữ liệu thương hiệu`;

    return basePrompt + brandSection;
}

module.exports = {
    buildBrandContext,
    buildRichBrandContext,
    hasBrandData,
    injectBrandContextToPrompt
};
