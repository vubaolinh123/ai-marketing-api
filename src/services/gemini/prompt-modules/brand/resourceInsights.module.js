/**
 * Build insights from uploaded brand resources.
 */

const { analyzeImage } = require('../../imageAnalysis.service');
const { normalizeBrandSetup } = require('./normalizeBrandSetup.module');

const RESOURCE_INSIGHT_CACHE = new Map();

function trimText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function shortenText(value, maxLength = 260) {
    const text = trimText(value);
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3).trim()}...`;
}

function isUploadResource(url = '') {
    return typeof url === 'string' && url.trim().startsWith('/uploads/');
}

function extractTopBulletLines(text = '', maxItems = 2) {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
        .filter(Boolean);

    if (lines.length === 0) {
        return [];
    }

    return lines.slice(0, maxItems).map((line) => shortenText(line, 160));
}

async function analyzeUploadResource(url, options = {}) {
    if (RESOURCE_INSIGHT_CACHE.has(url)) {
        return RESOURCE_INSIGHT_CACHE.get(url);
    }

    const analysisPrompt = options.analysisPrompt || [
        'Phân tích tài nguyên thương hiệu này để hỗ trợ tạo nội dung marketing đa kênh.',
        'Tóm tắt ngắn gọn theo 4 ý: nhận diện thị giác, tone/phong cách, thông điệp có thể khai thác, lưu ý triển khai.',
        'Trả lời tiếng Việt, rõ ràng, súc tích.'
    ].join(' ');

    const analysis = await analyzeImage(url, analysisPrompt, options.modelName || null);
    const compact = shortenText(analysis, 500);
    const bullets = extractTopBulletLines(analysis, 3);

    const result = {
        analysis: compact,
        bullets,
        analyzedAt: Date.now()
    };

    RESOURCE_INSIGHT_CACHE.set(url, result);
    return result;
}

async function buildResourceInsights(aiSettings, options = {}) {
    const normalized = normalizeBrandSetup(aiSettings);
    const resources = normalized.logo.localUploadResourceLinks || [];

    if (resources.length === 0) {
        return {
            summaryText: '',
            notes: [],
            analyzedCount: 0,
            totalUploadResources: 0
        };
    }

    const notes = [];

    for (const resource of resources) {
        const url = resource.url;
        if (!isUploadResource(url)) continue;

        try {
            const cached = await analyzeUploadResource(url, options);
            const noteText = cached.bullets?.length
                ? cached.bullets.join(' | ')
                : cached.analysis;

            notes.push({
                label: resource.label,
                url,
                note: noteText,
                analysis: cached.analysis
            });
        } catch (error) {
            // best effort - swallow per-file analysis errors
            notes.push({
                label: resource.label,
                url,
                note: 'Không phân tích được tài nguyên này ở thời điểm hiện tại.',
                analysis: ''
            });
        }
    }

    const usableNotes = notes
        .filter((item) => item.note)
        .map((item, idx) => `- [${idx + 1}] ${item.label}: ${shortenText(item.note, 280)}`)
        .join('\n');

    const summaryText = usableNotes
        ? [
            'Tóm tắt insight từ tài nguyên upload của thương hiệu:',
            usableNotes,
            'Khai thác các insight này nhất quán khi tạo bài viết, hình ảnh, kế hoạch marketing và kịch bản video.'
        ].join('\n')
        : '';

    return {
        summaryText,
        notes,
        analyzedCount: notes.filter((item) => item.analysis).length,
        totalUploadResources: resources.length
    };
}

module.exports = {
    buildResourceInsights,
    RESOURCE_INSIGHT_CACHE
};
