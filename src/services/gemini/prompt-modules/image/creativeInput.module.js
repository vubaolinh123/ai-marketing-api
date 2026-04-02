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

// Interpretive guidance maps: tell the AI model HOW to translate each field value into visual treatment
const AD_INTENSITY_GUIDANCE = {
    low: 'Subtle, understated presentation. Product speaks for itself with minimal staging drama. Natural, editorial feel. Muted props, soft tones, no visual "selling" pressure.',
    medium: 'Balanced commercial presentation. Product is clearly the hero with intentional but not aggressive staging. Professional catalog quality with moderate visual energy.',
    high: 'Bold, attention-grabbing commercial presentation. Strong visual impact with vibrant colors, dramatic lighting contrasts, dynamic composition. High-energy advertising feel that commands attention.'
};

const REALISM_PRIORITY_GUIDANCE = {
    photoreal: 'Strict photorealism. Must pass as an unedited DSLR photograph. No visible AI artifacts, no surreal elements. Match real-world physics for light, shadow, reflection, and material behavior.',
    balanced: 'Primarily photorealistic with subtle creative license. Minor stylistic enhancement is acceptable (slightly elevated saturation, idealized lighting) but core product rendering must look real.',
    creative: 'Allow creative interpretation while keeping the product recognizable. Stylistic treatments, color grading, and artistic lighting are welcome as long as product identity is preserved.'
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
        '### CREATIVE CONTEXT'
    ];

    // Usage purpose with interpretive guidance
    if (normalized.usagePurpose) {
        lines.push(`- Usage purpose: ${normalized.usagePurpose}. Tailor scene staging, mood, and visual energy to support this purpose.`);
    } else {
        lines.push('- Usage purpose: (not specified). Default to versatile commercial product photography.');
    }

    // Display info
    lines.push(`- Display info: ${normalized.displayInfo || '(not specified)'}`);

    // Ad intensity with interpretive guidance
    if (normalized.adIntensity && AD_INTENSITY_GUIDANCE[normalized.adIntensity]) {
        lines.push(`- Ad intensity: ${normalized.adIntensity}. Visual treatment: ${AD_INTENSITY_GUIDANCE[normalized.adIntensity]}`);
    } else {
        lines.push('- Ad intensity: (not specified). Default to medium balanced commercial presentation.');
    }

    // Typography guidance
    lines.push(`- Typography guidance: ${normalized.typographyGuidance || '(not specified)'}`);

    // Target audience with interpretive guidance
    if (normalized.targetAudience) {
        lines.push(`- Target audience: ${normalized.targetAudience}. Adjust visual language (color warmth, composition style, environmental cues) to resonate with this audience segment.`);
    } else {
        lines.push('- Target audience: (not specified)');
    }

    // Visual style with interpretive guidance
    if (normalized.visualStyle) {
        lines.push(`- Visual style: ${normalized.visualStyle}. Apply this style consistently to lighting mood, color grading, composition balance, and prop selection.`);
    } else {
        lines.push('- Visual style: (not specified). Default to clean, modern commercial photography.');
    }

    // Realism priority with interpretive guidance
    if (normalized.realismPriority) {
        const realismKey = normalizeDiacritics(normalized.realismPriority);
        const guidance = REALISM_PRIORITY_GUIDANCE[realismKey] || REALISM_PRIORITY_GUIDANCE.balanced;
        lines.push(`- Realism priority: ${normalized.realismPriority}. ${guidance}`);
    } else {
        lines.push(`- Realism priority: (not specified). ${REALISM_PRIORITY_GUIDANCE.photoreal}`);
    }

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
