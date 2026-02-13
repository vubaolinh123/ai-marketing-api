/**
 * Image creative input normalization + prompt block
 */

const CREATIVE_FIELDS = [
    'usagePurpose',
    'displayInfo',
    'adIntensity',
    'typographyGuidance',
    'targetAudience',
    'visualStyle',
    'realismPriority'
];

function normalizeCreativeInputs(input = {}) {
    return CREATIVE_FIELDS.reduce((acc, field) => {
        const value = input[field];
        acc[field] = typeof value === 'string' ? value.trim() : '';
        return acc;
    }, {});
}

function buildCreativeInputBlock(input = {}) {
    const normalized = normalizeCreativeInputs(input);
    const lines = [
        '### CREATIVE CONTEXT',
        `- Usage purpose: ${normalized.usagePurpose || '(not specified)'}`,
        `- Display info: ${normalized.displayInfo || '(not specified)'}`,
        `- Ad intensity: ${normalized.adIntensity || '(not specified)'}`,
        `- Typography guidance: ${normalized.typographyGuidance || '(not specified)'}`,
        `- Target audience: ${normalized.targetAudience || '(not specified)'}`,
        `- Visual style: ${normalized.visualStyle || '(not specified)'}`,
        `- Realism priority: ${normalized.realismPriority || '(not specified)'}`
    ];

    return {
        normalized,
        block: lines.join('\n')
    };
}

module.exports = {
    CREATIVE_FIELDS,
    normalizeCreativeInputs,
    buildCreativeInputBlock
};
