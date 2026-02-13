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

const AD_INTENSITY_CANONICAL = {
    low: [
        'low', 'light', 'subtle', 'soft', 'minimal', 'gentle',
        'nhẹ', 'nhe', 'ít', 'it', 'thấp', 'thap', 'tối thiểu', 'toi thieu'
    ],
    medium: [
        'medium', 'balanced', 'moderate', 'normal', 'standard',
        'vừa', 'vua', 'trung bình', 'trung binh', 'can bang', 'cân bằng'
    ],
    high: [
        'high', 'strong', 'aggressive', 'bold', 'intense', 'maximum', 'max',
        'mạnh', 'manh', 'cao', 'đậm', 'dam', 'nổi bật', 'noi bat'
    ]
};

function normalizeDiacritics(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeAdIntensity(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';

    const normalized = normalizeDiacritics(raw);

    if (AD_INTENSITY_CANONICAL.low.some((token) => normalizeDiacritics(token) === normalized)) {
        return 'low';
    }

    if (AD_INTENSITY_CANONICAL.medium.some((token) => normalizeDiacritics(token) === normalized)) {
        return 'medium';
    }

    if (AD_INTENSITY_CANONICAL.high.some((token) => normalizeDiacritics(token) === normalized)) {
        return 'high';
    }

    return '';
}

function normalizeCreativeInputs(input = {}) {
    return CREATIVE_FIELDS.reduce((acc, field) => {
        const value = input[field];
        if (field === 'adIntensity') {
            acc[field] = normalizeAdIntensity(value);
            return acc;
        }

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
