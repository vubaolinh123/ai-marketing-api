/**
 * Campaign thinking prompt module
 */

const CAMPAIGN_THINKING_FIELDS = [
    'priorityProductService',
    'monthlyFocus',
    'promotions',
    'customerJourneyStage',
    'targetSegment',
    'strategySuggestion'
];

function normalizeSimpleText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeList(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => normalizeSimpleText(item))
            .filter(Boolean);
    }

    const single = normalizeSimpleText(value);
    return single ? [single] : [];
}

function textFromValue(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (Array.isArray(value)) {
        return value
            .map((item) => textFromValue(item))
            .filter(Boolean)
            .join(', ')
            .trim();
    }

    if (value && typeof value === 'object') {
        return Object.entries(value)
            .map(([key, nested]) => {
                const nestedText = textFromValue(nested);
                if (!nestedText) return '';
                return `${key}: ${nestedText}`;
            })
            .filter(Boolean)
            .join('; ')
            .trim();
    }

    return '';
}

function normalizeStrategySuggestion(strategySuggestion) {
    if (typeof strategySuggestion === 'string') {
        return strategySuggestion.trim();
    }

    if (!strategySuggestion || typeof strategySuggestion !== 'object' || Array.isArray(strategySuggestion)) {
        return '';
    }

    const concept = normalizeSimpleText(strategySuggestion.concept);
    const contentPillars = normalizeList(strategySuggestion.contentPillars);
    const topicMix = normalizeList(strategySuggestion.topicMix);
    const recommendedChannels = normalizeList(strategySuggestion.recommendedChannels);
    const recommendedGoals = normalizeList(strategySuggestion.recommendedGoals);
    const rationale = normalizeSimpleText(strategySuggestion.rationale);

    const lines = [];
    if (concept) lines.push(`Concept: ${concept}`);
    if (contentPillars.length) lines.push(`Content pillars: ${contentPillars.join(', ')}`);
    if (topicMix.length) lines.push(`Topic mix: ${topicMix.join(', ')}`);
    if (recommendedChannels.length) lines.push(`Recommended channels: ${recommendedChannels.join(', ')}`);
    if (recommendedGoals.length) lines.push(`Recommended goals: ${recommendedGoals.join(', ')}`);
    if (rationale) lines.push(`Rationale: ${rationale}`);

    if (lines.length > 0) {
        return lines.join(' | ');
    }

    return textFromValue(strategySuggestion);
}

function normalizeCampaignThinking(input = {}) {
    return CAMPAIGN_THINKING_FIELDS.reduce((acc, field) => {
        const value = input[field];
        if (field === 'strategySuggestion') {
            acc[field] = normalizeStrategySuggestion(value);
        } else {
            acc[field] = normalizeSimpleText(value);
        }
        return acc;
    }, {});
}

function buildCampaignThinkingBlock(input = {}) {
    const normalized = normalizeCampaignThinking(input);

    return {
        normalized,
        block: [
            '## CAMPAIGN THINKING',
            `- Priority product/service: ${normalized.priorityProductService || '(chưa cung cấp)'}`,
            `- Monthly focus: ${normalized.monthlyFocus || '(chưa cung cấp)'}`,
            `- Promotions: ${normalized.promotions || '(chưa cung cấp)'}`,
            `- Customer journey stage: ${normalized.customerJourneyStage || '(chưa cung cấp)'}`,
            `- Target segment: ${normalized.targetSegment || '(chưa cung cấp)'}`,
            `- Strategy suggestion from user: ${normalized.strategySuggestion || '(chưa cung cấp)'}`
        ].join('\n')
    };
}

module.exports = {
    CAMPAIGN_THINKING_FIELDS,
    normalizeCampaignThinking,
    buildCampaignThinkingBlock
};
