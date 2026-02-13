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

// Upload directory for AI-generated product images
const PRODUCT_IMAGES_DIR = path.join(process.cwd(), 'uploads', 'images', 'product-images');

// Ensure directory exists
if (!fs.existsSync(PRODUCT_IMAGES_DIR)) {
    fs.mkdirSync(PRODUCT_IMAGES_DIR, { recursive: true });
}

// Background type descriptions for prompt
const BACKGROUND_DESCRIPTIONS = {
    'studio': 'professional photography studio with soft lighting, clean white/gray backdrop',
    'outdoor': 'outdoor natural environment with soft daylight, nature or urban backdrop',
    'lifestyle': 'real-life usage context showing the product being used naturally (e.g., someone holding, using, or interacting with the product)',
    'minimal': 'ultra-clean minimal background with solid color, modern aesthetic',
    'luxury': 'premium luxurious setting with marble, velvet, gold accents, sophisticated lighting',
    'kitchen': 'professional modern kitchen setting with cooking equipment and utensils',
    'restaurant': 'elegant restaurant dining setting with table, plates, professional presentation',
    'action': 'dynamic action scene showing the product in motion or being actively used',
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

const CAMERA_ANGLE_PROMPTS = {
    wide: 'wide shot, full composition, product and surrounding context clearly visible',
    medium: 'medium shot, balanced framing between product and context',
    closeup: 'close-up shot, product dominates frame while keeping contextual cues',
    topdown: 'top-down / flat-lay perspective with clear product arrangement',
    detail: 'macro detail shot, emphasize premium texture, material, and craftsmanship details'
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
        isPhotorealPriority
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

function buildDeterministicHardNegativeRules(intentSignals = {}) {
    const {
        wantsOutdoor,
        wantsHumanPresence,
        wantsAction,
        actionType,
        isPhotorealPriority
    } = intentSignals;

    const rules = [
        'Do not alter product identity: shape, material, colors, packaging details, logos, and label marks must stay consistent.',
        'Do not replace the product with another variant, ingredient set, or unrelated object.',
        'Do not generate text overlays, watermarks, or AI-invented brand marks.'
    ];

    if (isPhotorealPriority) {
        rules.push('Do not apply stylized filters, surreal grading, or non-photoreal rendering.');
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
        requestedSceneSummary
    } = intentSignals;

    const lines = [
        requestedSceneSummary ? `Requested scene summary: ${requestedSceneSummary}` : 'Requested scene summary: follow user context for this generation.',
        wantsOutdoor
            ? 'Outdoor intent: REQUIRED. Build believable outdoor depth and natural light.'
            : 'Outdoor intent: NOT requested. Keep non-outdoor context unless explicitly requested.',
        wantsHumanPresence
            ? 'Human presence intent: ALLOWED/REQUESTED. Include natural interaction while preserving full product recognizability.'
            : 'Human presence intent: NOT requested. Keep scene free of people and hands unless explicitly requested.',
        wantsAction
            ? `Action intent: REQUESTED (${actionType || 'use'}). Keep action natural and subordinate to product identity.`
            : 'Action intent: NOT requested. Keep scene static and product-focused.',
        'Conflict rule: do not preserve original reference background when it conflicts with this USER SCENE INTENT.'
    ].filter(Boolean);

    return lines.map((line) => `- ${line}`).join('\n');
}

function buildIdentityAnchor(productAnalysis = {}) {
    const colors = Array.isArray(productAnalysis.colors) && productAnalysis.colors.length > 0
        ? productAnalysis.colors.join(', ')
        : 'match the exact colors from original image';

    const keyFeatures = Array.isArray(productAnalysis.features) && productAnalysis.features.length > 0
        ? productAnalysis.features.slice(0, 6).join('; ')
        : 'preserve all distinctive visual features from original image';

    return [
        `Product type: ${productAnalysis.productType || productAnalysis.category || 'same product as reference'}`,
        `Shape: ${productAnalysis.shape || 'same silhouette and proportions as reference image'}`,
        `Material/texture: ${productAnalysis.material || ''} ${productAnalysis.texture || ''}`.trim() || 'same material and texture as reference image',
        `Colors: ${colors}`,
        `Patterns/marks: ${productAnalysis.patterns || productAnalysis.brandElements || 'no changes to logos/marks/details'}`,
        `Must-keep features: ${keyFeatures}`,
        'Identity lock rule: Keep product identity at 90-95% consistency with the original reference across all angles.',
        'Scene consistency rule: Keep scene coherent with user intent for this generation; never force original reference background if it conflicts with requested scene intent.',
        'Allowed variation rule: Camera viewpoint/framing and minor natural interaction motion only.'
    ].join('\n');
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
        `Create one consistent ${backgroundType || 'studio'} product scene (${backgroundDesc}).`,
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

    const deterministicHardNegativeRules = buildDeterministicHardNegativeRules(intentSignals);
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
        sanitizedBrandContext,
        creativeBlock,
        photorealGuardrails,
        isAnchor,
        hasCanonicalRef,
        hasPreviousRef,
        retryLevel
    } = params;

    const sizeInfo = OUTPUT_SIZES[outputSize] || OUTPUT_SIZES['1:1'];
    const angleDescription = CAMERA_ANGLE_PROMPTS[cameraAngle] || CAMERA_ANGLE_PROMPTS.wide;

    const attachedReferences = [
        '- Image #1: ORIGINAL PRODUCT (highest priority identity lock)',
        hasCanonicalRef ? '- Image #2: CANONICAL ANCHOR IMAGE (second priority scene lock)' : null,
        hasPreviousRef ? '- Image #3: PREVIOUS ANGLE IMAGE (continuity support)' : null,
    ].filter(Boolean).join('\n');

    const retryInstruction = retryLevel > 0
        ? `\n### RETRY MODE (attempt ${retryLevel + 1})\nBe extra strict about identity continuity. Reduce any style drift. Keep all immutable attributes exactly consistent with references.`
        : '';

    const anchorInstruction = isAnchor
        ? 'You are generating the canonical anchor image for this batch. This image will be used as the visual baseline for all other angles.'
        : 'You are generating a non-anchor angle. Match canonical and original references as closely as possible while changing only viewpoint.';

    const negativeRules = (sceneBlueprint.hardNegativeRules || []).map((rule, index) => `${index + 1}. ${rule}`).join('\n');
    const intentSummary = `outdoor=${intentSignals?.wantsOutdoor ? 'yes' : 'no'}, human=${intentSignals?.wantsHumanPresence ? 'yes' : 'no'}, action=${intentSignals?.wantsAction ? (intentSignals?.actionType || 'yes') : 'no'}`;

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
- ORIGINAL and CANONICAL references are identity lock sources for product shape/material/colors/labels.
- PREVIOUS ANGLE reference is continuity support only.
- Do NOT preserve original reference background when it conflicts with USER SCENE INTENT.

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
- Framing guidance: ${angleDescription}

### USER SCENE INTENT (HIGH PRIORITY)
${userSceneIntentBlock || '- Follow user scene request while preserving product identity lock.'}
- Resolved intent signals: ${intentSummary}

### HARD NEGATIVE RULES
${negativeRules}

### TECHNICAL REQUIREMENTS
- Aspect ratio: ${sizeInfo.label} (${sizeInfo.width}x${sizeInfo.height})
- Style: Photorealistic professional commercial photography
- Keep natural and coherent shadows with unchanged scene context
- No text, no watermark, no AI-invented branding

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
        console.error('analyzeProductImage error:', error);
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
            const response = await fetch(logoUrl);
            if (!response.ok) return null;
            
            const buffer = Buffer.from(await response.arrayBuffer());
            const ext = logoUrl.match(/\.(png|jpg|jpeg|webp|svg)$/i)?.[1] || 'png';
            const tempPath = path.join(PRODUCT_IMAGES_DIR, `temp-logo-${uuidv4()}.${ext}`);
            
            fs.writeFileSync(tempPath, buffer);
            return tempPath;
        }
        
        return null;
    } catch (error) {
        console.error('downloadLogo error:', error);
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
        console.error('overlayLogo error:', error);
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

    const imageModel = genAI.getGenerativeModel({
        model: modelName || MODELS.IMAGE_GEN,
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
        retryLevel
    });

    logPromptDebug({
        tool: 'image',
        step: 'prompt-built',
        data: {
            mode: 'single-angle',
            modelName: modelName || MODELS.IMAGE_GEN,
            cameraAngle,
            retryLevel,
            promptPreview: prompt
        }
    });

    const originalPart = toInlineDataPart(originalImagePath);
    const canonicalPart = toInlineDataPart(canonicalImagePath);
    const previousPart = toInlineDataPart(previousAngleImagePath);

    const requestPayload = [
        originalPart,
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
                brandContextLengthRaw: (brandContext || '').length
            }
        });

        const productAnalysis = await analyzeProductImage(originalImagePath);

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
        console.error('generateProductWithBackground error:', error);
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
