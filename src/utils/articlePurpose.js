const PRESET_PURPOSE_VALUES = [
    'introduce',
    'sell',
    'share_knowledge',
    'brand_awareness',
    'attract_leads',
    'nurture_educate',
    'convert_sales',
    'retention_loyalty',
    'brand_positioning'
];

const PURPOSE_ALIASES = {
    introduce: 'introduce',
    'gioi thieu': 'introduce',
    'gioi thieu san pham': 'introduce',
    'gioi thieu san pham dich vu': 'introduce',

    sell: 'sell',
    sales: 'sell',
    'ban hang': 'sell',
    'khuyen mai': 'sell',

    share_knowledge: 'share_knowledge',
    'share knowledge': 'share_knowledge',
    'chia se kien thuc': 'share_knowledge',

    brand_awareness: 'brand_awareness',
    'brand awareness': 'brand_awareness',
    'tang nhan dien thuong hieu': 'brand_awareness',
    'nhan dien thuong hieu': 'brand_awareness',

    attract_leads: 'attract_leads',
    'attract leads': 'attract_leads',
    leads: 'attract_leads',
    'thu hut khach hang tiem nang': 'attract_leads',

    nurture_educate: 'nurture_educate',
    'nurture educate': 'nurture_educate',
    'nurture and educate': 'nurture_educate',
    'nuoi duong va giao duc': 'nurture_educate',
    'nuoi duong giao duc': 'nurture_educate',

    convert_sales: 'convert_sales',
    'convert sales': 'convert_sales',
    'convert sale': 'convert_sales',
    'convert / sales': 'convert_sales',
    'chuyen doi ban hang': 'convert_sales',

    retention_loyalty: 'retention_loyalty',
    'retention loyalty': 'retention_loyalty',
    'retention and loyalty': 'retention_loyalty',
    'giu chan va trung thanh': 'retention_loyalty',
    'duy tri trung thanh': 'retention_loyalty',

    brand_positioning: 'brand_positioning',
    'brand positioning': 'brand_positioning',
    'dinh vi thuong hieu': 'brand_positioning'
};

// Backward compatibility for legacy schemas that only allow:
// ['introduce', 'sell', 'share_knowledge']
const LEGACY_PURPOSE_FALLBACK = {
    introduce: 'introduce',
    sell: 'sell',
    share_knowledge: 'share_knowledge',
    brand_awareness: 'introduce',
    attract_leads: 'sell',
    nurture_educate: 'share_knowledge',
    convert_sales: 'sell',
    retention_loyalty: 'share_knowledge',
    brand_positioning: 'introduce'
};

function normalizePurposeKey(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[_/\\-]+/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function resolvePresetPurpose(value) {
    const normalized = normalizePurposeKey(value);

    if (!normalized) {
        return '';
    }

    if (PURPOSE_ALIASES[normalized]) {
        return PURPOSE_ALIASES[normalized];
    }

    const snakeCase = normalized.replace(/\s+/g, '_');
    if (PURPOSE_ALIASES[snakeCase]) {
        return PURPOSE_ALIASES[snakeCase];
    }

    return PRESET_PURPOSE_VALUES.includes(snakeCase) ? snakeCase : '';
}

function resolveArticlePurpose(purpose, enumValues = []) {
    const rawValue = typeof purpose === 'string' ? purpose.trim() : '';
    const presetValue = resolvePresetPurpose(rawValue);
    const enumList = Array.isArray(enumValues) ? enumValues.filter(Boolean) : [];

    let storageValue = rawValue;

    if (enumList.length > 0) {
        const rawLower = rawValue.toLowerCase();
        const presetLower = presetValue.toLowerCase();
        const rawNormalized = normalizePurposeKey(rawValue);
        const presetNormalized = normalizePurposeKey(presetValue);

        const exactMatch = enumList.find(
            (item) => item === rawValue || (presetValue && item === presetValue)
        );

        const caseInsensitiveMatch = enumList.find(
            (item) => item.toLowerCase() === rawLower || (presetLower && item.toLowerCase() === presetLower)
        );

        const normalizedMatch = enumList.find((item) => {
            const itemNormalized = normalizePurposeKey(item);
            if (!itemNormalized) {
                return false;
            }

            if (itemNormalized === rawNormalized || (presetNormalized && itemNormalized === presetNormalized)) {
                return true;
            }

            const itemCanonical = resolvePresetPurpose(item);
            return Boolean(itemCanonical && presetValue && itemCanonical === presetValue);
        });

        const legacyFallback = presetValue ? LEGACY_PURPOSE_FALLBACK[presetValue] : '';

        if (exactMatch) {
            storageValue = exactMatch;
        } else if (caseInsensitiveMatch) {
            storageValue = caseInsensitiveMatch;
        } else if (normalizedMatch) {
            storageValue = normalizedMatch;
        } else if (legacyFallback && enumList.includes(legacyFallback)) {
            storageValue = legacyFallback;
        } else {
            // Always keep persisted value valid when schema has strict enum.
            storageValue = enumList[0];
        }
    }

    return {
        rawValue,
        promptValue: presetValue || rawValue,
        storageValue,
        isPreset: Boolean(presetValue)
    };
}

module.exports = {
    resolveArticlePurpose,
    resolvePresetPurpose,
    PRESET_PURPOSE_VALUES
};
