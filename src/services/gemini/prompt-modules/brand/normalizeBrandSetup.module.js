/**
 * Normalize brand setup data from AI Settings
 */

function cleanString(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
}

function cleanStringArray(values = []) {
    if (!Array.isArray(values)) return [];
    return values
        .map((item) => cleanString(item))
        .filter(Boolean);
}

function normalizeResourceLinks(resourceLinks = []) {
    if (!Array.isArray(resourceLinks)) return [];

    return resourceLinks
        .map((item, index) => {
            const label = cleanString(item?.label, `Tài nguyên ${index + 1}`);
            const url = cleanString(item?.url);
            if (!url) return null;
            return { label, url };
        })
        .filter(Boolean);
}

function normalizeContextDescriptions(contextDescriptions = []) {
    if (!Array.isArray(contextDescriptions)) return [];

    return contextDescriptions
        .map((item) => {
            const context = cleanString(item?.context);
            const description = cleanString(item?.description);
            if (!context || !description) return null;
            return { context, description };
        })
        .filter(Boolean);
}

function normalizeBrandSetup(aiSettings = {}) {
    const logoResourceLinks = normalizeResourceLinks(aiSettings?.logo?.resourceLinks);

    return {
        logo: {
            brandName: cleanString(aiSettings?.logo?.brandName),
            logoUrl: cleanString(aiSettings?.logo?.logoUrl),
            brandIdentity: cleanString(aiSettings?.logo?.brandIdentity),
            resourceLinks: logoResourceLinks,
            localUploadResourceLinks: logoResourceLinks.filter((item) => item.url.startsWith('/uploads/'))
        },
        colors: {
            primaryColor: cleanString(aiSettings?.colors?.primaryColor, '#F59E0B'),
            backgroundColor: cleanString(aiSettings?.colors?.backgroundColor, '#1a1a1a'),
            accentColor: cleanString(aiSettings?.colors?.accentColor, '#0891b2')
        },
        language: {
            keywords: cleanStringArray(aiSettings?.language?.keywords),
            customerTerm: cleanString(aiSettings?.language?.customerTerm),
            brandPronoun: cleanString(aiSettings?.language?.brandPronoun)
        },
        tone: {
            overallTone: cleanStringArray(aiSettings?.tone?.overallTone),
            contextDescriptions: normalizeContextDescriptions(aiSettings?.tone?.contextDescriptions)
        },
        product: {
            productGroups: cleanStringArray(aiSettings?.product?.productGroups),
            strengths: cleanString(aiSettings?.product?.strengths),
            suitableFor: cleanStringArray(aiSettings?.product?.suitableFor)
        }
    };
}

module.exports = {
    normalizeBrandSetup,
    cleanString,
    cleanStringArray
};
