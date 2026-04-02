/**
 * Product Image Service
 * Generates product images with custom backgrounds and logo using Gemini AI
 * Logo overlay is done programmatically using Sharp for accuracy
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { genAI, getModel, MODELS, parseJsonResponse } = require('./gemini.config');
const { composePromptBlocks } = require('./prompt-modules/shared/composer');
const { buildCreativeInputBlock, normalizeCreativeInputs } = require('./prompt-modules/image/creativeInput.module');
const { buildFnbPhotorealGuardrails } = require('./prompt-modules/image/fnbPhotoreal.module');
const { logPromptDebug } = require('../../utils/promptDebug');
const {
    buildDisplayTextRules,
    isDetailedApiLogEnabled,
    logError,
    logOutboundRequest,
    logOutboundResponse
} = require('../../utils/logger');

// Upload directory for AI-generated product images
const PRODUCT_IMAGES_DIR = path.join(process.cwd(), 'uploads', 'images', 'product-images');

// Ensure directory exists
if (!fs.existsSync(PRODUCT_IMAGES_DIR)) {
    fs.mkdirSync(PRODUCT_IMAGES_DIR, { recursive: true });
}

// Background type descriptions for prompt
const BACKGROUND_DESCRIPTIONS = {
    'studio': 'professional photography studio. Three-point lighting setup (soft key light at 45 degrees, fill light opposite, subtle rim/hair light for separation). Clean seamless white-to-light-gray paper backdrop with gentle gradient at the base. Neutral 5600K color temperature. Controlled specular highlights and soft diffused shadows. Commercial catalog-grade finish.',
    'outdoor': 'outdoor natural environment with authentic daylight. Golden-hour or overcast soft-box-like natural light with gentle warm tones. Believable spatial depth with foreground, midground, and background layers. Natural elements (foliage, sky, ground texture) supporting but not competing with the product. Realistic atmospheric haze or distance blur for depth.',
    'lifestyle': 'real-life usage context showing the product being used or interacted with naturally. Warm, inviting ambient lighting as in a well-lit home, cafe, or workspace. Human presence is natural and candid (not posed). Product is clearly identifiable even when held or in use. Environmental storytelling that communicates the product benefit. Shallow depth of field keeps product sharp against a contextually rich but non-distracting background.',
    'minimal': 'ultra-clean minimal background. Single solid color (white, off-white, soft gray, or muted pastel) with no texture or pattern. Perfectly even, shadow-free lighting or a single soft directional shadow for subtle depth. Modern Scandinavian aesthetic. Maximum visual breathing room around the product. No props, no distractions, product-only purity.',
    'luxury': 'premium luxurious setting evoking high-end brand campaigns. Rich materials: polished marble surface, brushed brass or gold accents, deep velvet fabric drapes, or dark slate. Dramatic chiaroscuro lighting with warm key light and deep, controlled shadows. Subtle specular reflections on glossy surfaces. Color palette: deep blacks, warm golds, rich burgundy, or cool silver. Every element communicates exclusivity and craftsmanship.',
    'kitchen': 'professional modern kitchen setting. Warm practical ambient lighting (3200-4000K) balanced by soft overhead or window fill. Stainless steel, natural wood, or stone countertop surfaces. Contextual props (cutting board, fresh herbs, quality cookware) arranged with editorial intent. Steam, moisture, or oil sheen where temperature-appropriate. Clean but lived-in, not sterile. Food-magazine editorial quality.',
    'restaurant': 'elegant restaurant dining setting. Sophisticated table setup with quality tableware, linen, and glassware. Warm ambient lighting with accent spots (candle glow, pendant lights). Rich color palette of the dining environment complementing the product. Depth-of-field separates the hero product from background diners or decor. Fine-dining editorial photography quality with intentional composition.',
    'action': 'dynamic action scene showing the product in motion or being actively used. Frozen-moment photography with crisp subject against motion-implied background. Energetic composition with diagonal lines and dynamic balance. Lighting emphasizes the action: directional key light with motion-trail ambient. Product identity remains fully readable even during action. Sports/adventure photography aesthetic.',
    'custom': '' // User will provide their own description
};

// Logo position mapping to Sharp gravity/position
const LOGO_POSITIONS = {
    'top-left': { gravity: 'northwest', offsetX: 30, offsetY: 30 },
    'top-right': { gravity: 'northeast', offsetX: 30, offsetY: 30 },
    'bottom-left': { gravity: 'southwest', offsetX: 30, offsetY: 30 },
    'bottom-right': { gravity: 'southeast', offsetX: 30, offsetY: 30 },
    'center': { gravity: 'center', offsetX: 0, offsetY: 0 }
};

// Output size aspect ratios
const OUTPUT_SIZES = {
    '1:1': { width: 1024, height: 1024, label: 'square' },
    '4:5': { width: 1024, height: 1280, label: 'portrait 4:5' },
    '9:16': { width: 720, height: 1280, label: 'vertical story 9:16' },
    '16:9': { width: 1280, height: 720, label: 'landscape 16:9' },
    '3:4': { width: 960, height: 1280, label: 'portrait 3:4' }
};

const CAMERA_ANGLES = ['wide', 'medium', 'closeup', 'topdown', 'detail'];

// Aspect-ratio-aware composition adjustments per angle
// Helps the AI understand how a given angle plays differently in vertical vs square vs landscape frames
const ASPECT_RATIO_ANGLE_ADJUSTMENTS = {
    'wide': {
        '9:16': 'Vertical wide shot: stack depth vertically — foreground product at lower third, environment fills upper two-thirds. Use vertical leading lines (columns, shelves, walls) to guide the eye.',
        '16:9': 'Cinematic wide shot: full horizontal span with product placed at power point (left or right third). Maximize horizontal environmental storytelling.',
        '4:5': 'Slightly tall wide shot: give modest vertical breathing room above the scene. Product in lower-center with environmental context above.',
        '1:1': 'Square wide shot: centered composition with equal environmental context on all sides. Use symmetry or rule-of-thirds diagonally.',
        '3:4': 'Portrait wide shot: modest vertical emphasis. Product slightly below center with environment framing it above and to the sides.'
    },
    'medium': {
        '9:16': 'Vertical medium shot: product occupies middle band of frame with vertical negative space above and below for context. Ideal for stories/reels aspect.',
        '16:9': 'Landscape medium shot: product offset to one side with environmental context filling the horizontal remainder. Cinematic balance.',
        '4:5': 'Social-optimized medium shot: product slightly above center with tight but balanced framing. Instagram-feed ready.',
        '1:1': 'Square medium shot: classic product-centered composition. Equal padding on all sides.',
        '3:4': 'Tall medium shot: product centered with slight vertical emphasis. Clean and balanced.'
    },
    'closeup': {
        '9:16': 'Vertical close-up: product fills the tall frame with key features positioned at eye-level center band. Minimal but visible environment at top and bottom edges.',
        '16:9': 'Landscape close-up: product stretched across horizontal frame. Show side-to-side details. Good for banner/header use.',
        '4:5': 'Portrait close-up: product fills frame with tight vertical crop. Ideal for social media posts.',
        '1:1': 'Square close-up: product centered and filling frame evenly. Symmetrical, impactful.',
        '3:4': 'Tall close-up: product fills frame with slight vertical emphasis on hero features.'
    },
    'topdown': {
        '9:16': 'Vertical flat-lay: arrange elements in a vertical flow — product centered with props stacked above and below. Phone-screen friendly layout.',
        '16:9': 'Landscape flat-lay: spread elements horizontally. Product center-left or center-right with props arranged along the horizontal axis.',
        '4:5': 'Portrait flat-lay: slightly taller arrangement. Product centered with modest vertical spacing for props.',
        '1:1': 'Square flat-lay: classic grid or radial arrangement centered on the product. Maximize symmetry.',
        '3:4': 'Tall flat-lay: vertical arrangement with product at visual center of gravity.'
    },
    'detail': {
        '9:16': 'Vertical macro: fill the tall frame with a vertical slice of the product detail. Show texture gradient from sharp focus to soft bokeh along the vertical axis.',
        '16:9': 'Landscape macro: horizontal detail sweep showing texture and material across the wide frame. Good for revealing surface patterns.',
        '4:5': 'Portrait macro: tight vertical crop on the most compelling detail area. Social-optimized detail showcase.',
        '1:1': 'Square macro: centered detail fill. Maximum visual impact on the hero texture or feature.',
        '3:4': 'Tall macro: vertical detail emphasis with shallow depth of field gradient.'
    }
};

const CAMERA_ANGLE_PROMPTS = {
    wide: 'wide establishing shot (approx. 35mm equivalent). Full scene composition with product at roughly 30-40% of frame area. Show complete environment, spatial depth, and surrounding context. Shallow-to-medium depth of field keeps product sharp while background retains readable detail. Natural leading lines draw the eye to the product.',
    medium: 'medium shot (approx. 50-85mm equivalent). Product occupies 50-65% of frame with balanced negative space. Subject-to-background ratio emphasizes product while preserving environmental context. Moderate depth of field with soft background separation. Classic commercial photography framing with rule-of-thirds placement.',
    closeup: 'close-up shot (approx. 85-135mm equivalent). Product fills 70-85% of frame, dominating the composition. Shallow depth of field creates pronounced background bokeh while keeping the entire product tack-sharp. Minimal but visible contextual cues at frame edges anchor the scene. Highlight hero features, labels, and key selling points.',
    topdown: 'top-down / flat-lay perspective, camera directly overhead at 90-degree angle. Clean spatial arrangement with intentional negative space between elements. Even, shadow-free lighting or soft directional shadow for depth. Product centered or placed using golden-ratio grid. Ideal for showing product footprint, layout, and surrounding accessories.',
    detail: 'macro detail shot (approx. 100mm+ macro equivalent). Extreme close-up emphasizing premium texture, material grain, surface finish, and craftsmanship details. Very shallow depth of field with razor-thin focal plane on the hero detail. Capture tactile qualities: stitching, embossing, brushed metal, condensation, or ingredient texture. Fill frame with the most visually compelling product detail.'
};

function normalizeCameraAngles(cameraAngles) {
    const input = Array.isArray(cameraAngles) && cameraAngles.length > 0
        ? cameraAngles
        : ['wide'];

    const normalized = [];
    for (const angle of input) {
        if (!CAMERA_ANGLES.includes(angle)) continue;
        if (!normalized.includes(angle)) {
            normalized.push(angle);
        }
    }

    return normalized.length > 0 ? normalized : ['wide'];
}

function getMimeTypeFromPath(filePath) {
    const ext = path.extname(filePath || '').toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
}

function toInlineDataPart(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        return null;
    }

    const imageBuffer = fs.readFileSync(filePath);
    return {
        inlineData: {
            mimeType: getMimeTypeFromPath(filePath),
            data: imageBuffer.toString('base64')
        }
    };
}

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function matchAnyKeyword(text, keywords = []) {
    const normalizedText = normalizeText(text);

    return keywords.some((keyword) => {
        const normalizedKeyword = normalizeText(keyword);
        if (!normalizedKeyword) return false;

        const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
        return pattern.test(normalizedText);
    });
}

function buildIntentSignals({
    backgroundType,
    customBackground,
    additionalNotes,
    usagePurpose,
    displayInfo,
    visualStyle,
    productAnalysis
} = {}) {
    const normalizedBackgroundType = normalizeText(backgroundType);

    const userIntentText = normalizeText([
        backgroundType,
        customBackground,
        additionalNotes,
        usagePurpose,
        displayInfo,
        visualStyle
    ].filter(Boolean).join(' '));

    const normalizedText = userIntentText;

    const wantsOutdoor = normalizedBackgroundType === 'outdoor' || matchAnyKeyword(normalizedText, [
        'outdoor', 'outside', 'open air', 'nature', 'natural park', 'street', 'garden', 'beach', 'sunlight',
        'ngoai troi', 'ngoai canh', 'thien nhien', 'cong vien', 'duong pho', 'san vuon', 'bo bien', 'anh sang tu nhien'
    ]);

    const explicitNoHumanPresence = matchAnyKeyword(userIntentText, [
        'no people', 'without people', 'without person', 'no human', 'no hands',
        'khong nguoi', 'khong co nguoi', 'khong ban tay'
    ]);

    const wantsHumanPresenceRaw = matchAnyKeyword(normalizedText, [
        'human interaction', 'people interacting', 'person', 'people', 'hands', 'holding', 'using', 'diner', 'customer', 'server', 'chef',
        'co nguoi', 'con nguoi', 'tuong tac', 'ban tay', 'cam tren tay', 'su dung', 'thuc khach', 'khach hang', 'phuc vu', 'dau bep'
    ]);

    const wantsEatingAction = matchAnyKeyword(normalizedText, [
        'eat', 'eating', 'bite', 'biting', 'taste', 'tasting', 'consume', 'consuming',
        'thuong thuc', 'an uong', 'nham nhi', 'dang an', 'dang uong', 'nguoi an', 'nguoi uong'
    ]);

    const wantsDrinkingAction = matchAnyKeyword(normalizedText, [
        'drink', 'drinking', 'sip', 'sipping', 'beverage', 'cocktail', 'coffee drinking',
        'uong', 'dang uong', 'nham nhi', 'thuong thuc do uong'
    ]);

    const wantsCookingAction = matchAnyKeyword(normalizedText, [
        'cook', 'cooking', 'prepare', 'preparing', 'grill', 'grilling', 'fry', 'frying', 'roast', 'roasting', 'bake', 'baking', 'boil', 'boiling', 'plate', 'plating',
        'nau', 'nau nuong', 'che bien', 'nuong', 'ran', 'chien', 'xao', 'hap', 'dau bep', 'phuc vu mon'
    ]);

    const wantsServingAction = matchAnyKeyword(normalizedText, [
        'serve', 'serving', 'presentation', 'plated service', 'table service',
        'phuc vu', 'bay mon', 'mang mon', 'don mon'
    ]);

    const wantsUseAction = matchAnyKeyword(normalizedText, [
        'use', 'using', 'in use', 'hands-on', 'demonstration', 'actively used',
        'su dung', 'dang su dung', 'trai nghiem'
    ]);

    const backgroundSuggestsAction = normalizedBackgroundType === 'action';
    const wantsAction = backgroundSuggestsAction || wantsEatingAction || wantsDrinkingAction || wantsCookingAction || wantsServingAction || wantsUseAction;

    let actionType = 'none';
    if (wantsEatingAction) actionType = 'eat';
    else if (wantsDrinkingAction) actionType = 'drink';
    else if (wantsCookingAction) actionType = 'cook';
    else if (wantsServingAction) actionType = 'serve';
    else if (wantsUseAction || backgroundSuggestsAction) actionType = 'use';

    const wantsHumanPresence = !explicitNoHumanPresence && (
        wantsHumanPresenceRaw
        || normalizedBackgroundType === 'lifestyle'
        || (wantsAction && actionType !== 'none')
    );

    // Detect if user explicitly wants to preserve the original scene composition/angle
    const wantsPreserveOriginalComposition = matchAnyKeyword(normalizedText, [
        // English
        'preserve original', 'keep original', 'same scene', 'same angle', 'same background',
        'same framing', 'same composition', 'keep background', 'keep scene', 'do not change background',
        'dont change background', 'no background change', 'keep camera', 'same camera',
        // Vietnamese
        'giu nguyen', 'giu goc may', 'giu khong gian', 'goc may goc', 'toan bo khong gian',
        'khong gian nay', 'goc may nay', 'khong thay doi nen', 'khong doi nen', 'giu nguyen nen',
        'giu nguyen toan bo', 'nguyen ban', 'khong gian goc', 'giu nguyen khong gian',
        'giu nguyen goc may', 'toan bo nen', 'nen goc', 'zoom xa', 'goc rong', 'toan canh',
        'giu nguyen boi canh', 'giu boi canh', 'khong thay doi boi canh', 'khong thay doi goc'
    ]);

    const isStylizedExplicit = matchAnyKeyword(userIntentText, [
        'anime', 'cartoon', 'chibi', 'illustration', '2d', 'lofi', 'manga', 'comic'
    ]);

    const isPhotorealPriority = matchAnyKeyword(userIntentText, [
        'photoreal', 'photo realistic', 'realistic', 'hyperreal', 'true to life', 'commercial photography',
        'chan thuc', 'nhu that', 'anh that', 'thuc te'
    ]) || !isStylizedExplicit;

    const requestedSceneSummary = [
        backgroundType ? `Background=${backgroundType}` : 'Background=studio',
        customBackground ? `Custom=${customBackground}` : null,
        usagePurpose ? `Purpose=${usagePurpose}` : null,
        displayInfo ? `Display=${displayInfo}` : null,
        visualStyle ? `Style=${visualStyle}` : null,
        additionalNotes ? `Notes=${additionalNotes}` : null,
        productAnalysis?.productType ? `Product=${productAnalysis.productType}` : null
    ].filter(Boolean).join(' | ').slice(0, 700);

    return {
        wantsOutdoor,
        wantsHumanPresence,
        wantsAction,
        actionType,
        requestedSceneSummary,
        wantsEatingAction,
        wantsDrinkingAction,
        wantsCookingAction,
        wantsServingAction,
        wantsUseAction,
        wantsHumanInteraction: wantsHumanPresence,
        isPhotorealPriority,
        wantsPreserveOriginalComposition
    };
}

function sanitizeBrandContextForImagePrompt(brandContext, { visualStyle, additionalNotes } = {}) {
    const rawContext = typeof brandContext === 'string' ? brandContext : '';
    const originalLength = rawContext.length;

    if (!rawContext.trim()) {
        return {
            sanitizedContext: '',
            removedSignals: [],
            originalLength,
            finalLength: 0
        };
    }

    const maxLength = 1200;
    const noisySignals = [
        'anime', 'lofi', 'cartoon', 'chibi', 'illustration', '2d', 'comic', 'manga', 'pixel art',
        'cell shading', 'vector style', 'flat design', 'watercolor', 'oil painting', 'sketch'
    ];

    const userStyleText = normalizeText([visualStyle, additionalNotes].filter(Boolean).join(' '));
    const explicitlyRequestedSignals = new Set(
        noisySignals.filter((signal) => matchAnyKeyword(userStyleText, [signal]))
    );

    const removedSignals = new Set();
    const filteredLines = rawContext
        .split(/\r?\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            let sanitizedLine = line;
            const normalizedLine = normalizeText(line);

            for (const signal of noisySignals) {
                if (explicitlyRequestedSignals.has(signal)) continue;

                const normalizedSignal = normalizeText(signal);
                if (normalizedLine.includes(normalizedSignal)) {
                    removedSignals.add(signal);
                    const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(escaped, 'ig');
                    sanitizedLine = sanitizedLine.replace(regex, '');
                }
            }

            sanitizedLine = sanitizedLine
                .replace(/[\s,;:|/-]{2,}/g, ' ')
                .replace(/\s+\./g, '.')
                .trim();

            return sanitizedLine;
        })
        .filter((line) => /[a-z0-9]/i.test(line));

    let sanitizedContext = filteredLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (sanitizedContext.length > maxLength) {
        sanitizedContext = `${sanitizedContext.slice(0, maxLength).trim()}...`;
    }

    return {
        sanitizedContext,
        removedSignals: Array.from(removedSignals),
        originalLength,
        finalLength: sanitizedContext.length
    };
}

function buildDeterministicHardNegativeRules(intentSignals = {}, displayInfo = '') {
    const {
        wantsOutdoor,
        wantsHumanPresence,
        wantsAction,
        actionType,
        isPhotorealPriority,
        wantsPreserveOriginalComposition
    } = intentSignals;

    const hasDisplayText = typeof displayInfo === 'string' && displayInfo.trim().length > 0;

    const rules = [
        'Do not alter product identity: shape, material, colors, packaging details, logos, and label marks must stay consistent.',
        'Do not replace the product with another variant, ingredient set, or unrelated object.',
        hasDisplayText
            ? 'Do not generate any readable text except the exact required DISPLAY TEXT POLICY string.'
            : 'Do not generate text overlays, watermarks, or AI-invented brand marks.'
    ];

    if (isPhotorealPriority) {
        rules.push('Do not apply stylized filters, surreal grading, or non-photoreal rendering.');
    }

    if (wantsPreserveOriginalComposition) {
        rules.push('Do not zoom in, do not crop, do not reframe, and do not change the camera distance or angle. Preserve the original scene composition and field-of-view EXACTLY as in the reference image. Only add the requested subjects (people/objects) into the existing scene without altering framing.');
        rules.push('Do not replace or significantly alter the background, environment, or spatial context of the original reference image.');
    }

    if (!wantsOutdoor) {
        rules.push('Do not force outdoor scenery when user intent does not request it.');
    }

    if (!wantsHumanPresence) {
        rules.push('Do not add people or hand interaction unless explicitly requested by user intent.');
    }

    if (!wantsAction) {
        rules.push('Do not depict action or active product usage unless explicitly requested by user intent.');
    } else if (actionType && actionType !== 'none') {
        rules.push(`Do not depict actions unrelated to "${actionType}" when action is requested.`);
    }

    return rules;
}

function sanitizeHardNegativeRules(rules = [], intentSignals = {}) {
    const {
        wantsOutdoor,
        wantsHumanPresence,
        wantsAction,
        actionType
    } = intentSignals;

    const sourceRules = Array.isArray(rules) ? rules : [];
    const dedup = new Set();

    return sourceRules
        .map((rule) => String(rule || '').trim())
        .filter(Boolean)
        .filter((rule) => {
            const normalizedRule = normalizeText(rule);

            const blocksOutdoor = /(do not|never|avoid).*(outdoor|outside|nature|daylight)/.test(normalizedRule);
            if (wantsOutdoor && blocksOutdoor) return false;

            const blocksHuman = /(do not|never|avoid).*(people|person|human|hands|model|customer|chef|server)/.test(normalizedRule);
            if (wantsHumanPresence && blocksHuman) return false;

            const blocksAction = /(do not|never|avoid).*(action|using|usage|eat|drink|cook|serve)/.test(normalizedRule)
                && !/(unrelated|except|other than)/.test(normalizedRule);
            if (wantsAction && blocksAction) return false;

            if (wantsAction && actionType && actionType !== 'none') {
                const blocksRequestedAction =
                    (actionType === 'eat' && /(do not|never|avoid).*(eat|eating|bite|consume)/.test(normalizedRule))
                    || (actionType === 'drink' && /(do not|never|avoid).*(drink|drinking|sip|beverage)/.test(normalizedRule))
                    || (actionType === 'cook' && /(do not|never|avoid).*(cook|cooking|prepare|grill|fry|bake)/.test(normalizedRule))
                    || (actionType === 'serve' && /(do not|never|avoid).*(serve|serving|plated|presentation)/.test(normalizedRule))
                    || (actionType === 'use' && /(do not|never|avoid).*(use|using|hands on|demonstration)/.test(normalizedRule));

                if (blocksRequestedAction) return false;
            }

            if (dedup.has(normalizedRule)) return false;
            dedup.add(normalizedRule);
            return true;
        });
}

function buildUserSceneIntentBlock(intentSignals = {}) {
    const {
        wantsOutdoor,
        wantsHumanPresence,
        wantsAction,
        actionType,
        requestedSceneSummary,
        wantsPreserveOriginalComposition
    } = intentSignals;

    const lines = [
        requestedSceneSummary ? `Requested scene summary: ${requestedSceneSummary}` : 'Requested scene summary: follow user context for this generation.',
        wantsPreserveOriginalComposition
            ? '⚠️ PRESERVE ORIGINAL COMPOSITION (HIGHEST PRIORITY): User has explicitly requested to KEEP the original scene, camera angle, background, and spatial layout UNCHANGED. Do NOT reframe, crop, zoom in, or change the background environment. Only add requested subjects naturally within the existing scene.'
            : null,
        wantsOutdoor
            ? 'Outdoor intent: REQUIRED. Build believable outdoor depth and natural light.'
            : 'Outdoor intent: NOT requested. Keep non-outdoor context unless explicitly requested.',
        wantsHumanPresence
            ? 'Human presence intent: ALLOWED/REQUESTED. Include natural interaction while preserving full product recognizability.'
            : 'Human presence intent: NOT requested. Keep scene free of people and hands unless explicitly requested.',
        wantsAction
            ? `Action intent: REQUESTED (${actionType || 'use'}). Keep action natural and subordinate to product identity.`
            : 'Action intent: NOT requested. Keep scene static and product-focused.',
        wantsPreserveOriginalComposition
            ? 'Conflict rule: PRESERVE original reference background and composition as explicitly requested by user. This OVERRIDES any default background-change behavior.'
            : 'Conflict rule: do not preserve original reference background when it conflicts with this USER SCENE INTENT.'
    ].filter(Boolean);

    return lines.map((line) => `- ${line}`).join('\n');
}

function buildIdentityAnchor(productAnalysis = {}) {
    const colors = Array.isArray(productAnalysis.colors) && productAnalysis.colors.length > 0
        ? productAnalysis.colors.join(', ')
        : 'CRITICAL: match the exact colors from the original reference image pixel-by-pixel. Do not shift hue, saturation, or brightness.';

    const keyFeatures = Array.isArray(productAnalysis.features) && productAnalysis.features.length > 0
        ? productAnalysis.features.slice(0, 6).join('; ')
        : 'CRITICAL: preserve ALL distinctive visual features exactly as they appear in the original reference image. Copy every detail.';

    const shapeDesc = productAnalysis.shape
        ? productAnalysis.shape
        : 'CRITICAL: replicate the exact silhouette, proportions, aspect ratio, and dimensional relationships from the original reference image. No reshaping.';

    const materialDesc = `${productAnalysis.material || ''} ${productAnalysis.texture || ''}`.trim()
        || 'CRITICAL: replicate the exact material appearance, surface finish, and tactile quality visible in the original reference image.';

    const patternDesc = productAnalysis.patterns || productAnalysis.brandElements
        || 'CRITICAL: preserve all logos, labels, marks, engravings, and surface details exactly. Do not add, remove, or alter any branding element.';

    const lines = [
        `Product type: ${productAnalysis.productType || productAnalysis.category || 'same product as reference — identify from attached reference image'}`,
        `Shape: ${shapeDesc}`,
        `Material/texture: ${materialDesc}`,
        `Colors: ${colors}`,
        `Patterns/marks: ${patternDesc}`,
        `Must-keep features: ${keyFeatures}`,
    ];

    // Multi-reference enhanced identity lock
    if (productAnalysis.multiRefMode && productAnalysis.sourceImageCount > 1) {
        const confidence = productAnalysis.crossRefConfidence || {};
        lines.push(
            `Multi-reference mode: ACTIVE (${productAnalysis.sourceImageCount} source images analyzed).`,
            `Cross-reference confidence: color=${confidence.colorConsistency || 'n/a'}, shape=${confidence.shapeConsistency || 'n/a'}, material=${confidence.materialConsistency || 'n/a'}, overall=${confidence.overallIdentityConfidence || 'n/a'}.`,
            productAnalysis.dimensionalProfile
                ? `3D dimensional profile: ${productAnalysis.dimensionalProfile}`
                : '',
            'Identity lock rule (MULTI-REF): Cross-referenced product identity from multiple angles has HIGHER confidence. Maintain 95%+ consistency with the consensus features. Features confirmed by multiple source images are IMMUTABLE. Single-source features should still be preserved.',
            'IMPORTANT: You have multiple reference images showing this product from different angles. Use ALL of them to build a complete understanding of the product. When generating from a new angle, check which reference image is closest to the target angle and weight it highest for geometric/perspective details.'
        );
    } else {
        lines.push(
            'Identity lock rule: Keep product identity at 90-95% consistency with the original reference across all angles. When in doubt, copy the reference exactly rather than improvising.'
        );
    }

    lines.push(
        'Scene consistency rule: Keep scene coherent with user intent for this generation; never force original reference background if it conflicts with requested scene intent.',
        'Allowed variation rule: Camera viewpoint/framing and minor natural interaction motion only. Product shape, color, material, branding, and proportions are IMMUTABLE.'
    );

    return lines.filter(Boolean).join('\n');
}

async function buildConsistentSceneBlueprint(params) {
    const {
        productAnalysis,
        backgroundType,
        customBackground,
        additionalNotes,
        usagePurpose,
        displayInfo,
        intentSignals = {},
        brandContext
    } = params;
    const backgroundDesc = BACKGROUND_DESCRIPTIONS[backgroundType] || BACKGROUND_DESCRIPTIONS.studio;
    const sceneParts = [
        intentSignals.wantsPreserveOriginalComposition
            ? `⚠️ PRESERVE ORIGINAL SCENE (USER REQUEST): Maintain the exact original ${backgroundType || 'existing'} scene from the reference image. Do NOT change the background, environment, spatial layout, camera distance, or framing.`
            : `Create one consistent ${backgroundType || 'studio'} product scene (${backgroundDesc}).`,
        productAnalysis?.summary ? `Preserve product appearance cues from analysis: ${productAnalysis.summary}.` : null,
        customBackground ? `Primary custom scene direction: ${customBackground}.` : null,
        usagePurpose ? `Usage purpose cue: ${usagePurpose}.` : null,
        displayInfo ? `Display presentation cue: ${displayInfo}.` : null,
        additionalNotes ? `Additional user notes to honor: ${additionalNotes}.` : null,
        intentSignals.wantsOutdoor
            ? 'Environment should clearly read as outdoor with natural spatial depth and believable daylight.'
            : 'Environment should stay aligned with requested non-outdoor context unless user explicitly asks otherwise.',
        (intentSignals.wantsHumanPresence || intentSignals.wantsAction)
            ? 'Human interaction is allowed where requested, while keeping the product fully recognizable and primary.'
            : 'Do not introduce human interaction unless explicitly requested.',
        intentSignals.wantsAction
            ? `Requested action type: ${intentSignals.actionType || 'use'} (do not substitute with unrelated action).`
            : 'No action requested; keep scene static and product-focused.',
        brandContext ? `Optional low-priority brand context cue: ${brandContext}.` : null
    ].filter(Boolean);

    const lightingBlueprint = intentSignals.wantsOutdoor
        ? 'Use consistent natural daylight with coherent shadow direction, realistic contrast, and neutral white balance across all angles.'
        : (backgroundType === 'kitchen' || backgroundType === 'restaurant' || intentSignals.wantsCookingAction)
            ? 'Use warm practical ambient lighting balanced by soft key fill to preserve realistic food/product textures and color fidelity across angles.'
            : 'Use consistent professional photorealistic lighting with stable shadow softness and white balance across all angle outputs.';

    const compositionParts = [
        'Keep product scale, identity cues, and relative placement to key scene elements stable across outputs.',
        'Only camera viewpoint/framing should vary between angles.',
        displayInfo ? `Respect display framing requirements: ${displayInfo}.` : null,
        intentSignals.wantsAction
            ? 'When action is requested, preserve action continuity without hiding core product identity features.'
            : null
    ].filter(Boolean);

    const deterministicHardNegativeRules = buildDeterministicHardNegativeRules(intentSignals, displayInfo);
    const hardNegativeRules = sanitizeHardNegativeRules(deterministicHardNegativeRules, intentSignals);

    return {
        sceneBlueprint: sceneParts.join(' '),
        lightingBlueprint,
        compositionBlueprint: compositionParts.join(' '),
        hardNegativeRules
    };
}

function buildConsistentAnglePrompt(params) {
    const {
        identityAnchor,
        sceneBlueprint,
        cameraAngle,
        outputSize,
        additionalNotes,
        intentSignals,
        userSceneIntentBlock,
        displayTextPolicyBlock,
        hasDisplayText = false,
        sanitizedBrandContext,
        creativeBlock,
        photorealGuardrails,
        isAnchor,
        hasCanonicalRef,
        hasPreviousRef,
        hasMultipleRefs = false,
        multiRefCount = 1,
        retryLevel
    } = params;

    const sizeInfo = OUTPUT_SIZES[outputSize] || OUTPUT_SIZES['1:1'];
    const angleDescription = CAMERA_ANGLE_PROMPTS[cameraAngle] || CAMERA_ANGLE_PROMPTS.wide;

    // Get aspect-ratio-specific composition guidance for this angle
    const aspectRatioAdjustment = ASPECT_RATIO_ANGLE_ADJUSTMENTS[cameraAngle]?.[outputSize] || '';

    const attachedReferences = hasMultipleRefs
        ? [
            `- Images #1 to #${multiRefCount}: MULTI-REFERENCE PRODUCT IMAGES (${multiRefCount} source images from different angles — use ALL to build complete 3D product understanding)`,
            hasCanonicalRef ? `- Image #${multiRefCount + 1}: CANONICAL ANCHOR IMAGE (scene consistency lock)` : null,
            hasPreviousRef ? `- Image #${multiRefCount + (hasCanonicalRef ? 2 : 1)}: PREVIOUS ANGLE IMAGE (continuity support)` : null,
        ].filter(Boolean).join('\n')
        : [
            '- Image #1: ORIGINAL PRODUCT (highest priority identity lock)',
            hasCanonicalRef ? '- Image #2: CANONICAL ANCHOR IMAGE (second priority scene lock)' : null,
            hasPreviousRef ? '- Image #3: PREVIOUS ANGLE IMAGE (continuity support)' : null,
        ].filter(Boolean).join('\n');

    const multiRefInstructions = hasMultipleRefs
        ? `\n### MULTI-REFERENCE IMAGE STRATEGY (${multiRefCount} source images)
- You are given ${multiRefCount} different images of THE SAME PRODUCT from different angles/contexts.
- Build a complete 3D mental model by synthesizing ALL reference images together.
- Features visible consistently across multiple references have the HIGHEST confidence — they are IMMUTABLE.
- Features visible in only one reference should still be preserved but can be inferred from context.
- When generating the target angle, identify which reference image(s) are geometrically closest to the requested angle and weight their perspective details highest.
- Color, material, branding, and proportions must match the CONSENSUS across all references.
- IMPORTANT: More reference images = higher confidence. Use this to produce the most accurate product representation possible.`
        : '';

    const retryInstruction = retryLevel === 1
        ? `\n### RETRY MODE (attempt 2 of 3)
Recovery strategy: The previous attempt may have drifted from the reference.
- Give 100% priority to the ORIGINAL reference image for product identity. Copy its colors, shape, and details exactly.
- Reduce creative interpretation. Stay literal and faithful to references.
- If the canonical anchor image exists, match its scene lighting and color temperature precisely.
- Simplify the scene slightly: fewer props, less environmental complexity, more focus on product clarity.`
        : retryLevel >= 2
            ? `\n### RETRY MODE — MAXIMUM FIDELITY (final attempt)
Recovery strategy: Previous attempts failed to maintain consistency. Apply maximum constraints:
- COPY the product from the original reference as faithfully as possible. Zero creative liberty on product appearance.
- Use the simplest possible interpretation of the scene that still honors the user request.
- Minimize background complexity. Prefer clean, uncluttered compositions.
- Match the canonical anchor image lighting and color grading exactly if available.
- When in doubt about any detail, default to what is visible in the original reference image.
- Treat this as a "safety" generation: quality and consistency over creativity.`
            : '';

    const anchorInstruction = isAnchor
        ? 'You are generating the canonical anchor image for this batch. This image will be used as the visual baseline for all other angles.'
        : 'You are generating a non-anchor angle. Match canonical and original references as closely as possible while changing only viewpoint.';

    const negativeRules = (sceneBlueprint.hardNegativeRules || []).map((rule, index) => `${index + 1}. ${rule}`).join('\n');
    const intentSummary = `outdoor=${intentSignals?.wantsOutdoor ? 'yes' : 'no'}, human=${intentSignals?.wantsHumanPresence ? 'yes' : 'no'}, action=${intentSignals?.wantsAction ? (intentSignals?.actionType || 'yes') : 'no'}, preserveComposition=${intentSignals?.wantsPreserveOriginalComposition ? 'YES' : 'no'}`;

    const referenceUsagePolicy = intentSignals?.wantsPreserveOriginalComposition
        ? '- ORIGINAL reference background and composition MUST be preserved — user explicitly requested it. Do not alter the scene environment, framing, or camera angle.'
        : '- Do NOT preserve original reference background when it conflicts with USER SCENE INTENT.';

    const textRequirementLine = hasDisplayText
        ? '- Text rendering: ONLY the exact DISPLAY TEXT POLICY text is allowed. No extra words.'
        : '- No text, no watermark, no AI-invented branding';

    return composePromptBlocks([
        `## MULTI-ANGLE PRODUCT IMAGE GENERATION (CONSISTENCY MODE)

### INSTRUCTION PRIORITY
1) Safety policy
2) Product identity lock
3) User scene intent
4) Multi-angle consistency
5) Creative context
6) Brand context (non-conflicting)

### GOAL
Generate one image that belongs to the same angle set with high consistency.
- Similarity target with sibling images: 80-90%
- Allowed variation: 10-20% ONLY (camera viewpoint/framing)

### ATTACHED REFERENCE ORDER
${attachedReferences}

Reference usage policy:
${hasMultipleRefs
    ? `- ALL ${multiRefCount} product reference images are identity lock sources. Cross-reference them to build the most accurate product model.`
    : '- ORIGINAL and CANONICAL references are identity lock sources for product shape/material/colors/labels.'}
- PREVIOUS ANGLE reference is continuity support only.
${referenceUsagePolicy}
${multiRefInstructions}

### ROLE
${anchorInstruction}

### IMMUTABLE PRODUCT IDENTITY
${identityAnchor}

### IMMUTABLE SCENE BLUEPRINT
- Scene: ${sceneBlueprint.sceneBlueprint}
- Lighting: ${sceneBlueprint.lightingBlueprint}
- Composition: ${sceneBlueprint.compositionBlueprint}

### ANGLE DELTA (ONLY THIS MAY CHANGE)
- Target camera angle: ${cameraAngle}
- Framing guidance: ${intentSignals?.wantsPreserveOriginalComposition ? `KEEP ORIGINAL FRAMING — do not zoom in, do not crop; maintain the same field-of-view and composition as the reference. Original angle hint: ${angleDescription}` : angleDescription}
${aspectRatioAdjustment ? `- Aspect-ratio composition note (${outputSize}): ${aspectRatioAdjustment}` : ''}

### USER SCENE INTENT (HIGH PRIORITY)
${userSceneIntentBlock || '- Follow user scene request while preserving product identity lock.'}
- Resolved intent signals: ${intentSummary}

${displayTextPolicyBlock || ''}

### HARD NEGATIVE RULES
${negativeRules}

### TECHNICAL REQUIREMENTS
- Aspect ratio: ${sizeInfo.label} (${sizeInfo.width}x${sizeInfo.height})
- Style: Photorealistic professional commercial photography
- Keep natural and coherent shadows with unchanged scene context
- ${textRequirementLine}

### OPTIONAL USER NOTES
${additionalNotes || '(none)'}
${retryInstruction}

### BRAND CONTEXT (LOW PRIORITY)
${sanitizedBrandContext || '(none)'}`,
        creativeBlock,
        photorealGuardrails
    ]);
}

/**
 * Analyze multiple product reference images and build a consolidated identity profile.
 * Uses a two-phase approach:
 *   Phase 1: Analyze each image individually to capture angle-specific details
 *   Phase 2: Cross-reference all analyses to produce a high-confidence consensus profile
 *
 * @param {string[]} imagePaths - Array of file paths to product images (max 5)
 * @returns {Promise<Object>} Consolidated product analysis with confidence scoring
 */
async function analyzeMultipleProductImages(imagePaths) {
    if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
        throw new Error('At least one image path is required');
    }

    // If only one image, fall back to single analysis
    if (imagePaths.length === 1) {
        const analysis = await analyzeProductImage(imagePaths[0]);
        return {
            ...analysis,
            multiRefMode: false,
            sourceImageCount: 1,
            confidenceLevel: 'standard'
        };
    }

    const validPaths = imagePaths.filter(p => p && fs.existsSync(p)).slice(0, 5);
    if (validPaths.length === 0) {
        throw new Error('No valid image files found');
    }

    // Phase 1: Analyze each image individually in parallel
    const individualAnalyses = await Promise.all(
        validPaths.map(async (imgPath, index) => {
            try {
                const analysis = await analyzeProductImage(imgPath);
                return { index, path: imgPath, analysis, success: true };
            } catch (error) {
                logError('Multi-ref individual analysis error', {
                    service: 'product-image',
                    imageIndex: index,
                    imagePath: imgPath,
                    error
                });
                return { index, path: imgPath, analysis: null, success: false };
            }
        })
    );

    const successfulAnalyses = individualAnalyses.filter(a => a.success && a.analysis);
    if (successfulAnalyses.length === 0) {
        throw new Error('Failed to analyze any reference images');
    }

    // Phase 2: Cross-reference synthesis using Gemini Vision with ALL images
    const model = getModel('VISION');
    const imageParts = validPaths.map(imgPath => {
        const buffer = fs.readFileSync(imgPath);
        return {
            inlineData: {
                mimeType: getMimeTypeFromPath(imgPath),
                data: buffer.toString('base64')
            }
        };
    });

    const analysisJsonArray = successfulAnalyses.map(a => JSON.stringify(a.analysis, null, 2));

    const crossRefPrompt = `You are an expert product photographer and visual analyst performing CROSS-REFERENCE SYNTHESIS.

You are given ${validPaths.length} images of THE SAME PRODUCT from different angles/contexts, plus their individual analyses below.

## INDIVIDUAL ANALYSES (for reference):
${analysisJsonArray.map((json, i) => `### Image ${i + 1}:\n${json}`).join('\n\n')}

## YOUR TASK:
Cross-reference ALL images and analyses to produce ONE definitive, high-confidence product identity profile.

### CROSS-REFERENCING RULES:
1. **Consensus features**: If a feature (color, shape detail, material, branding) appears consistently across 2+ images, it has HIGH confidence. Weight it heavily.
2. **Unique-angle features**: Features visible in only one image (e.g., a back label seen only from behind) should be included but marked as single-source.
3. **Conflict resolution**: If images disagree (e.g., lighting makes colors look different), prefer the analysis from the most neutral/well-lit image. Note the variance.
4. **3D mental model**: Build a complete 360-degree mental model of the product. Each image fills in details from its angle.
5. **Detail stacking**: Each additional image should ADD detail certainty, not replace previous findings. More images = higher confidence on overlapping features.

### OUTPUT FORMAT:
Return a JSON object with this structure:
{
    "productType": "specific product name with model/variant (highest confidence from consensus)",
    "category": "main product category",
    "subcategory": "more specific category",
    "industry": "industry/niche",
    "state": "condition/state of the product",
    "material": "primary material(s) — confirmed by multiple angles",
    "features": ["feature 1 [HIGH: seen in N images]", "feature 2 [HIGH: seen in N images]", "feature 3 [SINGLE: image X only]", "...at least 8-12 features"],
    "colors": ["specific color with finish [confidence: high/medium]", "..."],
    "texture": "detailed texture description synthesized from all angles (3-4 sentences)",
    "shape": "full 3D shape description combining all viewing angles",
    "patterns": "all patterns, prints, or visual details found across all images",
    "qualityIndicators": ["quality sign 1", "quality sign 2"],
    "brandElements": "all visible branding from all angles combined",
    "targetMarket": "target market description",
    "mood": "overall mood/style consensus",
    "dimensionalProfile": "3D dimensional understanding built from multiple angles — describe the product shape from front, sides, top, and back as revealed by the reference images",
    "crossRefConfidence": {
        "colorConsistency": "high/medium/low — how consistent colors appeared across images",
        "shapeConsistency": "high/medium/low — how well the shape matches across angles",
        "materialConsistency": "high/medium/low — how consistently material/texture reads",
        "overallIdentityConfidence": "high/medium/low — overall confidence in the product identity lock"
    },
    "summary": "A COMPREHENSIVE 5-7 sentence summary describing this product as if explaining to another AI that needs to recreate it PERFECTLY from any angle. Include product type, key visual features, colors, textures, materials, and distinctive characteristics. Mark which features are confirmed by multiple angles vs single-source. This is the master reference for product identity."
}

Be EXTREMELY detailed. The summary must be comprehensive enough for another AI to generate this exact product from ANY angle without seeing the images.
Only return valid JSON.`;

    try {
        const result = await model.generateContent([
            crossRefPrompt,
            ...imageParts
        ]);

        const text = result.response.text();
        const parsed = parseJsonResponse(text);

        if (parsed) {
            return {
                ...parsed,
                multiRefMode: true,
                sourceImageCount: validPaths.length,
                individualAnalyses: successfulAnalyses.map(a => a.analysis),
                confidenceLevel: validPaths.length >= 3 ? 'high' : 'elevated'
            };
        }

        // Fallback: return best individual analysis + multi-ref flag
        return {
            ...successfulAnalyses[0].analysis,
            multiRefMode: true,
            sourceImageCount: validPaths.length,
            confidenceLevel: 'standard'
        };
    } catch (error) {
        logError('Multi-ref cross-reference synthesis error', {
            service: 'product-image',
            imageCount: validPaths.length,
            error
        });

        // Fallback to first successful analysis
        return {
            ...successfulAnalyses[0].analysis,
            multiRefMode: true,
            sourceImageCount: validPaths.length,
            confidenceLevel: 'fallback'
        };
    }
}

/**
 * Analyze product image using Gemini Vision
 * @param {string} imagePath - Path to the product image
 * @returns {Promise<Object>} Product analysis result
 */
async function analyzeProductImage(imagePath) {
    const model = getModel('VISION');
    
    // Read image file
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    
    const prompt = `You are an expert product photographer and visual analyst. Analyze this image in EXTREME DETAIL for AI image generation purposes.

This tool is used by many different businesses with various product types: electronics, fashion, cosmetics, food, furniture, jewelry, toys, automotive parts, tools, artwork, etc. Analyze accordingly.

## ANALYZE EVERY ASPECT:

### 1. PRODUCT/SUBJECT IDENTIFICATION
- Exact product type and category
- Specific model/variant/grade/quality level
  Examples: "iPhone 15 Pro Max Titanium", "Nike Air Jordan 1 Retro High", "Wagyu A5 ribeye steak", "La Mer moisturizing cream 60ml", "Rolex Submariner watch"
- Approximate dimensions and scale
- State/condition (new, used, raw, cooked, assembled, packaged, etc.)

### 2. VISUAL CHARACTERISTICS (BE VERY SPECIFIC)
- **Colors**: List ALL colors with specificity
  Examples: "matte titanium gray", "patent leather black with red accents", "deep ruby red with white marbling", "rose gold metallic finish"
- **Texture**: Describe surface texture in detail (smooth, rough, marbled, grainy, glossy, matte, brushed, polished, fabric weave, leather grain)
- **Shape**: Exact shape, contours, edges, silhouette
- **Patterns**: Any visible patterns, prints, logos, engravings, stitching, marbling
- **Material**: What material appears to be (metal, plastic, leather, fabric, glass, wood, ceramic, organic)
- **Surface finish**: How light interacts (reflective, matte, semi-gloss, metallic, pearlescent)

### 3. QUALITY & DETAILS
- Signs of quality/craftsmanship
- Professional presentation aspects
- Premium or luxury indicators
- Brand elements visible (logos, tags, packaging)

### 4. CURRENT SETTING
- Background description (color, texture, material, environment)
- Props or accompanying items
- Lighting style (studio, natural, dramatic, soft, hard)
- Photography angle and composition
- Overall staging and presentation

### 5. CONTEXT & MARKET
- Target market (luxury, budget, professional, consumer, B2B)
- Industry/niche (fashion, tech, food, beauty, home, sports, etc.)
- Likely use case
- Style/mood of the image (minimalist, vibrant, elegant, playful, professional)

Return a JSON object with this structure:
{
    "productType": "specific product name with model/variant",
    "category": "main product category",
    "subcategory": "more specific category",
    "industry": "industry/niche",
    "state": "condition/state of the product",
    "material": "primary material(s)",
    "features": ["detailed feature 1", "detailed feature 2", "...at least 5-7 features"],
    "colors": ["specific color with finish description", "..."],
    "texture": "detailed texture description (2-3 sentences)",
    "shape": "shape and dimension description",
    "patterns": "any patterns, prints, or visual details",
    "qualityIndicators": ["quality sign 1", "quality sign 2"],
    "brandElements": "any visible branding, logos, text",
    "currentBackground": "detailed background description",
    "props": ["prop 1", "prop 2"],
    "lightingStyle": "lighting description",
    "photographyAngle": "angle description",
    "targetMarket": "target market description",
    "mood": "overall mood/style",
    "summary": "A DETAILED 4-5 sentence summary describing this product as if explaining to another AI that needs to recreate it perfectly. Include product type, key visual features, colors, textures, and distinctive characteristics."
}

Be EXTREMELY detailed and specific. The summary should be comprehensive enough that another AI could visualize this exact product without seeing the image.
Only return valid JSON.`;

    try {
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    mimeType,
                    data: base64Image
                }
            }
        ]);
        
        const text = result.response.text();
        const parsed = parseJsonResponse(text);
        
        if (parsed) {
            return parsed;
        }
        
        return { summary: text };
    } catch (error) {
        logError('analyzeProductImage error', {
            service: 'product-image',
            imagePath,
            error
        });
        throw error;
    }
}

/**
 * Download logo from URL to local file
 * @param {string} logoUrl - URL of the logo
 * @returns {Promise<string|null>} Local file path or null
 */
async function downloadLogo(logoUrl) {
    if (!logoUrl) return null;
    
    try {
        // If it's a local file path
        if (logoUrl.startsWith('/uploads/')) {
            const localPath = path.join(process.cwd(), logoUrl);
            if (fs.existsSync(localPath)) {
                return localPath;
            }
        }
        
        // If it's a full URL, download it
        if (logoUrl.startsWith('http')) {
            const startedAt = process.hrtime.bigint();
            const debugEnabled = isDetailedApiLogEnabled();

            if (debugEnabled) {
                logOutboundRequest({
                    method: 'GET',
                    url: logoUrl,
                    operation: 'download-logo'
                });
            }

            const response = await fetch(logoUrl);
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

            if (debugEnabled || !response.ok) {
                logOutboundResponse({
                    method: 'GET',
                    url: logoUrl,
                    status: response.status,
                    durationMs,
                    operation: 'download-logo'
                });
            }

            if (!response.ok) return null;
            
            const buffer = Buffer.from(await response.arrayBuffer());
            const ext = logoUrl.match(/\.(png|jpg|jpeg|webp|svg)$/i)?.[1] || 'png';
            const tempPath = path.join(PRODUCT_IMAGES_DIR, `temp-logo-${uuidv4()}.${ext}`);
            
            fs.writeFileSync(tempPath, buffer);
            return tempPath;
        }
        
        return null;
    } catch (error) {
        logOutboundResponse({
            method: 'GET',
            url: logoUrl,
            status: error?.status || error?.statusCode || 500,
            error: error?.message || 'downloadLogo failed',
            operation: 'download-logo'
        });
        logError('downloadLogo error', {
            service: 'product-image',
            logoUrl,
            error
        });
        return null;
    }
}

/**
 * Overlay logo onto generated image using Sharp
 * @param {string} imagePath - Path to the generated image
 * @param {string} logoPath - Path to the logo file
 * @param {string} position - Logo position (top-left, top-right, etc.)
 * @param {string} outputSize - Output size ratio
 * @returns {Promise<string>} Path to the final image with logo
 */
async function overlayLogo(imagePath, logoPath, position, outputSize) {
    if (!logoPath || !fs.existsSync(logoPath)) {
        return imagePath;
    }
    
    try {
        const posConfig = LOGO_POSITIONS[position] || LOGO_POSITIONS['bottom-right'];
        const sizeConfig = OUTPUT_SIZES[outputSize] || OUTPUT_SIZES['1:1'];
        
        // Get image dimensions
        const imageMetadata = await sharp(imagePath).metadata();
        const imageWidth = imageMetadata.width || sizeConfig.width;
        const imageHeight = imageMetadata.height || sizeConfig.height;
        
        // Calculate logo size (15% of image width, max 200px)
        const logoMaxWidth = Math.min(Math.round(imageWidth * 0.15), 200);
        const logoMaxHeight = Math.min(Math.round(imageHeight * 0.15), 200);
        
        // Resize logo while maintaining aspect ratio
        const logoBuffer = await sharp(logoPath)
            .resize({
                width: logoMaxWidth,
                height: logoMaxHeight,
                fit: 'inside',
                withoutEnlargement: true
            })
            .toBuffer();
        
        // Get resized logo dimensions
        const logoMetadata = await sharp(logoBuffer).metadata();
        const logoWidth = logoMetadata.width;
        const logoHeight = logoMetadata.height;
        
        // Calculate position based on gravity
        let left, top;
        const padding = 30;
        
        switch (posConfig.gravity) {
            case 'northwest':
                left = padding;
                top = padding;
                break;
            case 'northeast':
                left = imageWidth - logoWidth - padding;
                top = padding;
                break;
            case 'southwest':
                left = padding;
                top = imageHeight - logoHeight - padding;
                break;
            case 'southeast':
                left = imageWidth - logoWidth - padding;
                top = imageHeight - logoHeight - padding;
                break;
            case 'center':
                left = Math.round((imageWidth - logoWidth) / 2);
                top = Math.round((imageHeight - logoHeight) / 2);
                break;
            default:
                left = imageWidth - logoWidth - padding;
                top = imageHeight - logoHeight - padding;
        }
        
        // Generate output filename
        const ext = path.extname(imagePath);
        const outputFilename = `${uuidv4()}${ext}`;
        const outputPath = path.join(PRODUCT_IMAGES_DIR, outputFilename);
        
        // Composite logo onto image
        await sharp(imagePath)
            .composite([
                {
                    input: logoBuffer,
                    left: Math.max(0, left),
                    top: Math.max(0, top)
                }
            ])
            .toFile(outputPath);

        logPromptDebug({
            tool: 'image',
            step: 'ai-response',
            data: {
                mode: 'logo-overlay',
                outputPath,
                position,
                outputSize
            }
        });
        
        // Clean up temp logo if it was downloaded
        if (logoPath.includes('temp-logo-')) {
            fs.unlinkSync(logoPath);
        }
        
        return `/uploads/images/product-images/${outputFilename}`;
    } catch (error) {
        logError('overlayLogo error', {
            service: 'product-image',
            imagePath,
            logoPath,
            position,
            outputSize,
            error
        });
        // Return original if overlay fails
        return imagePath.replace(process.cwd(), '').replace(/\\/g, '/');
    }
}

/**
 * Generate single product image for one camera angle with consistency references
 * @param {Object} params - Generation parameters
 * @returns {Promise<string>} URL path to generated image
 */
async function generateSingleAngleImage(params) {
    const {
        originalImagePath,
        additionalRefImagePaths,
        canonicalImagePath,
        previousAngleImagePath,
        identityAnchor,
        sceneBlueprint,
        intentSignals,
        cameraAngle,
        useLogo,
        logoPosition,
        logoUrl,
        outputSize,
        additionalNotes,
        userSceneIntentBlock,
        sanitizedBrandContext,
        creativeBlock,
        photorealGuardrails,
        isAnchor = false,
        retryLevel = 0,
        modelName
    } = params;

    const isMultiRef = Array.isArray(additionalRefImagePaths) && additionalRefImagePaths.length > 0;

    const imageModel = getModel('IMAGE_GEN', modelName || MODELS.IMAGE_GEN, {
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE']
        }
    });

    const prompt = buildConsistentAnglePrompt({
        identityAnchor,
        sceneBlueprint,
        cameraAngle,
        outputSize,
        additionalNotes,
        intentSignals,
        userSceneIntentBlock,
        sanitizedBrandContext,
        creativeBlock,
        photorealGuardrails,
        isAnchor,
        hasCanonicalRef: !!canonicalImagePath,
        hasPreviousRef: !!previousAngleImagePath,
        hasMultipleRefs: isMultiRef,
        multiRefCount: isMultiRef ? additionalRefImagePaths.length + 1 : 1,
        retryLevel
    });

    logPromptDebug({
        tool: 'image',
        step: 'prompt-built',
        data: {
            mode: isMultiRef ? 'multi-ref-single-angle' : 'single-angle',
            modelName: modelName || MODELS.IMAGE_GEN,
            cameraAngle,
            retryLevel,
            multiRefCount: isMultiRef ? additionalRefImagePaths.length + 1 : 1,
            promptPreview: prompt
        }
    });

    // Build image payload: primary image first, then additional references, then canonical/previous
    const originalPart = toInlineDataPart(originalImagePath);
    const additionalParts = isMultiRef
        ? additionalRefImagePaths.map(p => toInlineDataPart(p)).filter(Boolean)
        : [];
    const canonicalPart = toInlineDataPart(canonicalImagePath);
    const previousPart = toInlineDataPart(previousAngleImagePath);

    const requestPayload = [
        originalPart,
        ...additionalParts,
        canonicalPart,
        previousPart,
        prompt
    ].filter(Boolean);

    const result = await imageModel.generateContent(requestPayload);
    const response = result.response;

    // Check for image in response
    if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
                const imageData = part.inlineData.data;
                const mimeType = part.inlineData.mimeType;

                // Determine file extension
                const ext = mimeType === 'image/png' ? 'png' :
                    mimeType === 'image/webp' ? 'webp' : 'jpg';

                // Save image to disk
                const filename = `${uuidv4()}.${ext}`;
                const filePath = path.join(PRODUCT_IMAGES_DIR, filename);

                const imageBuffer = Buffer.from(imageData, 'base64');
                fs.writeFileSync(filePath, imageBuffer);

                let finalImageUrl = `/uploads/images/product-images/${filename}`;

                // Step 4: Overlay logo if enabled
                if (useLogo && logoUrl && logoPosition !== 'none') {
                    const logoPath = await downloadLogo(logoUrl);
                    if (logoPath) {
                        finalImageUrl = await overlayLogo(filePath, logoPath, logoPosition, outputSize);

                        // Clean up the non-logo version if a new file was created
                        if (finalImageUrl !== `/uploads/images/product-images/${filename}`) {
                            try {
                                fs.unlinkSync(filePath);
                            } catch (e) {
                                // Ignore cleanup errors
                            }
                        }
                    }
                }

                logPromptDebug({
                    tool: 'image',
                    step: 'ai-response',
                    data: {
                        mode: 'single-angle',
                        cameraAngle,
                        imageUrl: finalImageUrl
                    }
                });

                return finalImageUrl;
            }
        }
    }

    throw new Error('No image generated in response');
}

/**
 * Generate product images with background and logo for multiple camera angles
 * @param {Object} params - Generation parameters
 * @returns {Promise<Array<{angle: string, imageUrl: string, status: string, errorMessage: string}>>}
 */
async function generateProductWithBackground(params) {
    const {
        originalImagePath,
        additionalRefImagePaths,
        backgroundType,
        cameraAngles,
        customBackground,
        usagePurpose,
        displayInfo,
        adIntensity,
        typographyGuidance,
        targetAudience,
        visualStyle,
        realismPriority,
        useLogo,
        logoPosition,
        logoUrl,
        outputSize,
        additionalNotes,
        brandContext,
        modelName
    } = params;

    const isMultiRef = Array.isArray(additionalRefImagePaths) && additionalRefImagePaths.length > 0;

    try {
        logPromptDebug({
            tool: 'image',
            step: 'received-input',
            data: {
                backgroundType,
                cameraAngles,
                useLogo,
                logoPosition,
                outputSize,
                usagePurpose,
                displayInfo,
                adIntensity,
                typographyGuidance,
                targetAudience,
                visualStyle,
                realismPriority,
                hasBrandContext: !!brandContext,
                brandContextLengthRaw: (brandContext || '').length,
                multiRefMode: isMultiRef,
                totalRefImages: isMultiRef ? additionalRefImagePaths.length + 1 : 1
            }
        });

        // Use multi-image or single-image analysis based on mode
        const allImagePaths = isMultiRef
            ? [originalImagePath, ...additionalRefImagePaths]
            : [originalImagePath];
        const productAnalysis = isMultiRef
            ? await analyzeMultipleProductImages(allImagePaths)
            : await analyzeProductImage(originalImagePath);

        const intentSignals = buildIntentSignals({
            backgroundType,
            customBackground,
            additionalNotes,
            usagePurpose,
            displayInfo,
            visualStyle,
            productAnalysis
        });

        const brandContextSanitization = sanitizeBrandContextForImagePrompt(brandContext, {
            visualStyle,
            additionalNotes
        });
        const sanitizedBrandContext = brandContextSanitization.sanitizedContext;

        const creativeInputs = normalizeCreativeInputs({
            usagePurpose,
            displayInfo,
            adIntensity,
            typographyGuidance,
            targetAudience,
            visualStyle,
            realismPriority
        });
        const { block: creativeBlock } = buildCreativeInputBlock(creativeInputs);
        const { block: photorealGuardrails } = buildFnbPhotorealGuardrails({
            ...creativeInputs,
            backgroundType,
            customBackground,
            additionalNotes,
            brandContext: sanitizedBrandContext,
            intentSignals,
            ...productAnalysis
        });

        const identityAnchor = buildIdentityAnchor(productAnalysis);
        const displayTextPolicy = buildDisplayTextRules(displayInfo);
        const sceneBlueprint = await buildConsistentSceneBlueprint({
            productAnalysis,
            backgroundType,
            customBackground,
            usagePurpose,
            displayInfo,
            additionalNotes,
            intentSignals,
            brandContext: sanitizedBrandContext
        });

        const userSceneIntentBlock = buildUserSceneIntentBlock(intentSignals);

        logPromptDebug({
            tool: 'image',
            step: 'intent-resolution',
            data: {
                intentSignals,
                hardNegativeFinal: sceneBlueprint?.hardNegativeRules || [],
                brandContextLengthRaw: brandContextSanitization.originalLength,
                brandContextLengthSanitized: brandContextSanitization.finalLength,
                removedSignals: brandContextSanitization.removedSignals
            }
        });

        logPromptDebug({
            tool: 'image',
            step: 'brand-context',
            data: {
                available: !!brandContext,
                preview: sanitizedBrandContext,
                brandContextLengthRaw: brandContextSanitization.originalLength,
                brandContextLengthSanitized: brandContextSanitization.finalLength,
                removedSignals: brandContextSanitization.removedSignals
            }
        });

        const normalizedAngles = normalizeCameraAngles(cameraAngles);

        logPromptDebug({
            tool: 'image',
            step: 'prompt-built',
            data: {
                mode: 'multi-angle-plan',
                normalizedAngles,
                identityAnchor,
                sceneBlueprint,
                displayTextPolicy,
                intentSignals,
                userSceneIntentBlock,
                brandContextLengthRaw: brandContextSanitization.originalLength,
                brandContextLengthSanitized: brandContextSanitization.finalLength
            }
        });

        // Consistency-first generation order (sequential)
        const preferredOrder = ['medium', 'wide', 'closeup', 'detail', 'topdown'];
        const orderedAngles = [
            ...preferredOrder.filter(angle => normalizedAngles.includes(angle)),
            ...normalizedAngles.filter(angle => !preferredOrder.includes(angle))
        ];

        const generatedImages = [];
        let canonicalImagePath = null;
        let previousAngleImagePath = null;

        for (let i = 0; i < orderedAngles.length; i++) {
            const cameraAngle = orderedAngles[i];
            const isAnchor = i === 0;
            let successUrl = '';
            let errorMessage = '';

            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const angleSpecificNotes = additionalNotes
                        ? `${additionalNotes}\n\nAngle requirement: ${cameraAngle} - ${CAMERA_ANGLE_PROMPTS[cameraAngle] || ''}`
                        : `Angle requirement: ${cameraAngle} - ${CAMERA_ANGLE_PROMPTS[cameraAngle] || ''}`;

                    successUrl = await generateSingleAngleImage({
                        originalImagePath,
                        additionalRefImagePaths: isMultiRef ? additionalRefImagePaths : [],
                        canonicalImagePath,
                        previousAngleImagePath,
                        identityAnchor,
                        sceneBlueprint,
                        intentSignals,
                        cameraAngle,
                        useLogo,
                        logoPosition,
                        logoUrl,
                        outputSize,
                        additionalNotes: angleSpecificNotes,
                        userSceneIntentBlock,
                        displayTextPolicyBlock: displayTextPolicy.block,
                        hasDisplayText: !!displayTextPolicy.normalized,
                        sanitizedBrandContext,
                        creativeBlock,
                        photorealGuardrails,
                        isAnchor,
                        retryLevel: attempt,
                        modelName
                    });

                    errorMessage = '';
                    break;
                } catch (error) {
                    errorMessage = error.message || 'Lỗi khi tạo ảnh';
                }
            }

            if (successUrl) {
                const fullGeneratedPath = getFilePathFromUrl(successUrl);

                // First successful image becomes canonical anchor for continuity.
                if (!canonicalImagePath && fs.existsSync(fullGeneratedPath)) {
                    canonicalImagePath = fullGeneratedPath;
                }

                if (fs.existsSync(fullGeneratedPath)) {
                    previousAngleImagePath = fullGeneratedPath;
                }

                generatedImages.push({
                    angle: cameraAngle,
                    imageUrl: successUrl,
                    status: 'completed',
                    errorMessage: ''
                });
            } else {
                generatedImages.push({
                    angle: cameraAngle,
                    imageUrl: '',
                    status: 'failed',
                    errorMessage
                });
            }
        }

        const successCount = generatedImages.filter(item => item.status === 'completed' && item.imageUrl).length;
        if (successCount === 0) {
            throw new Error(generatedImages[0]?.errorMessage || 'No image generated in response');
        }

        logPromptDebug({
            tool: 'image',
            step: 'ai-response',
            data: {
                mode: 'multi-angle-result',
                total: generatedImages.length,
                successCount,
                failedCount: generatedImages.length - successCount,
                generatedImages
            }
        });

        return generatedImages;
    } catch (error) {
        logPromptDebug({
            tool: 'image',
            step: 'ai-response-error',
            data: {
                message: error?.message,
                stack: error?.stack
            }
        });
        logError('generateProductWithBackground error', {
            service: 'product-image',
            error
        });
        throw error;
    }
}

/**
 * Get full file path from URL path
 * @param {string} urlPath - URL path like /uploads/images/...
 * @returns {string} Full file system path
 */
function getFilePathFromUrl(urlPath) {
    if (!urlPath || typeof urlPath !== 'string') {
        throw new Error('Invalid image URL path');
    }

    let parsedPath = urlPath.trim();

    if (/^https?:\/\//i.test(parsedPath)) {
        try {
            const url = new URL(parsedPath);
            parsedPath = url.pathname || '';
        } catch (error) {
            throw new Error('Invalid image URL');
        }
    }

    if (!parsedPath.startsWith('/uploads/')) {
        throw new Error('Only local upload paths are supported (/uploads/...)');
    }

    const relativePath = parsedPath.replace(/^\/+/, '');
    return path.join(process.cwd(), relativePath);
}

module.exports = {
    analyzeProductImage,
    analyzeMultipleProductImages,
    generateProductWithBackground,
    generateSingleAngleImage,
    normalizeCameraAngles,
    overlayLogo,
    downloadLogo,
    getFilePathFromUrl,
    BACKGROUND_DESCRIPTIONS,
    CAMERA_ANGLES,
    CAMERA_ANGLE_PROMPTS,
    LOGO_POSITIONS,
    OUTPUT_SIZES
};
