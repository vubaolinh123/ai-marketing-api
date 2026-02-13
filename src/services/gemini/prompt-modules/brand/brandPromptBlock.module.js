/**
 * Build strict brand prompt block with normalized setup + resource insights.
 */

const { composePromptBlocks } = require('../shared/composer');
const { normalizeBrandSetup } = require('./normalizeBrandSetup.module');
const { buildResourceInsights } = require('./resourceInsights.module');

function buildListLine(label, list = []) {
    if (!Array.isArray(list) || list.length === 0) return null;
    return `- ${label}: ${list.join(', ')}`;
}

function buildMappedLines(title, items = []) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const lines = items
        .filter((item) => item && item.context && item.description)
        .map((item) => `  - ${item.context}: ${item.description}`)
        .join('\n');
    return lines ? `${title}\n${lines}` : null;
}

async function buildBrandPromptBlock(aiSettings) {
    if (!aiSettings) return null;

    const brand = normalizeBrandSetup(aiSettings);
    const resourceInsights = await buildResourceInsights(aiSettings);

    const identityBlock = [
        '## BRAND SETUP (BẮT BUỘC TUÂN THỦ)',
        `- Tên thương hiệu: ${brand.logo.brandName || '(chưa thiết lập)'}`,
        `- Nhận diện thương hiệu: ${brand.logo.brandIdentity || '(chưa thiết lập)'}`,
        `- Màu chủ đạo: ${brand.colors.primaryColor}`,
        `- Màu nền: ${brand.colors.backgroundColor}`,
        `- Màu nhấn: ${brand.colors.accentColor}`
    ].join('\n');

    const languageBlock = [
        '### Quy tắc ngôn ngữ thương hiệu',
        `- Customer term (xưng hô khách hàng): ${brand.language.customerTerm || '(chưa thiết lập)'}`,
        `- Brand pronoun (xưng hô thương hiệu): ${brand.language.brandPronoun || '(chưa thiết lập)'}`,
        buildListLine('Keywords thương hiệu', brand.language.keywords)
    ].filter(Boolean).join('\n');

    const toneBlock = [
        '### Giọng điệu & bối cảnh diễn đạt',
        buildListLine('Tone tổng thể', brand.tone.overallTone),
        buildMappedLines('Ngữ cảnh diễn đạt ưu tiên:', brand.tone.contextDescriptions)
    ].filter(Boolean).join('\n');

    const productBlock = [
        '### Sản phẩm / dịch vụ',
        buildListLine('Nhóm sản phẩm/dịch vụ', brand.product.productGroups),
        `- Điểm mạnh cốt lõi: ${brand.product.strengths || '(chưa thiết lập)'}`,
        buildListLine('Phù hợp với', brand.product.suitableFor)
    ].filter(Boolean).join('\n');

    const resourcesBlock = resourceInsights.summaryText
        ? `### Resource insights\n${resourceInsights.summaryText}`
        : null;

    const enforcementBlock = [
        '### Rules thực thi',
        '- Không dùng placeholder (ví dụ: [Tên thương hiệu], [Khách hàng], [Sản phẩm]).',
        '- Luôn ưu tiên dữ liệu Brand Setup khi đưa ra lập luận/ý tưởng/sáng tạo.',
        '- Không bịa dữ liệu ngoài phạm vi thương hiệu nếu không có tín hiệu rõ ràng.',
        '- Nội dung tạo ra phải nhất quán với customerTerm + brandPronoun đã thiết lập.'
    ].join('\n');

    return composePromptBlocks([
        identityBlock,
        languageBlock,
        toneBlock,
        productBlock,
        resourcesBlock,
        enforcementBlock
    ]);
}

module.exports = {
    buildBrandPromptBlock
};
