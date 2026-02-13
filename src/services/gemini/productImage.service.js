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
const { injectBrandContextToPrompt } = require('./brandContext.service');
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
        'Identity lock rule: Keep product identity and scene continuity at 80-90% similarity across all angle outputs.',
        'Allowed variation rule: Only camera viewpoint/framing may vary (10-20% max).'
    ].join('\n');
}

async function buildConsistentSceneBlueprint(params) {
    const { productAnalysis, backgroundType, customBackground, additionalNotes, brandContext } = params;
    const backgroundDesc = BACKGROUND_DESCRIPTIONS[backgroundType] || BACKGROUND_DESCRIPTIONS.studio;
    const model = getModel('TEXT');

    const prompt = `You are a senior art director for product photography consistency.

Your task: create ONE immutable scene blueprint for a multi-angle image set.
All outputs must look like the same product in the same scene, where only camera angle changes.

CONSTRAINTS:
- Similarity target across the whole set: 80-90%
- Allowed variation: 10-20% only (camera viewpoint/framing)
- Do NOT change product identity, materials, colors, props, or scene style between angles.

INPUT: PRODUCT ANALYSIS
${JSON.stringify(productAnalysis, null, 2)}

INPUT: BACKGROUND TYPE
- Type: ${backgroundType}
- Description: ${backgroundDesc}

INPUT: CUSTOM BACKGROUND
${customBackground || '(none)'}

INPUT: ADDITIONAL NOTES
${additionalNotes || '(none)'}

INPUT: BRAND CONTEXT
${brandContext || '(none)'}

Return STRICT JSON only:
{
  "sceneBlueprint": "120-180 words describing immutable scene setting and props",
  "lightingBlueprint": "specific lighting setup that must stay consistent",
  "compositionBlueprint": "composition constraints that stay consistent across angles",
  "hardNegativeRules": ["rule1", "rule2", "rule3", "rule4", "rule5"]
}`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const parsed = parseJsonResponse(text);

        if (parsed && parsed.sceneBlueprint) {
            return {
                sceneBlueprint: parsed.sceneBlueprint,
                lightingBlueprint: parsed.lightingBlueprint || 'soft realistic commercial lighting, consistent across all angles',
                compositionBlueprint: parsed.compositionBlueprint || 'same scene structure and relative product placement across all angles',
                hardNegativeRules: Array.isArray(parsed.hardNegativeRules) && parsed.hardNegativeRules.length > 0
                    ? parsed.hardNegativeRules
                    : [
                        'Do not alter product color/material/logo',
                        'Do not add/remove accessories or ingredients',
                        'Do not switch to a different product variant',
                        'Do not change scene style or color grading',
                        'No text, watermark, or additional branding'
                    ]
            };
        }
    } catch (error) {
        console.error('buildConsistentSceneBlueprint error:', error);
    }

    // Fallback deterministic blueprint
    return {
        sceneBlueprint: `Create one consistent ${backgroundType} product scene (${backgroundDesc}). Keep the same product setup, props, and environment style for every angle in the set. ${customBackground || ''}`.trim(),
        lightingBlueprint: 'Use consistent professional photorealistic lighting, shadow softness, and white balance across all angle outputs.',
        compositionBlueprint: 'Keep product scale, relative position to background elements, and overall styling consistent across outputs. Only camera viewpoint and crop can change.',
        hardNegativeRules: [
            'Do not alter product identity, shape, texture, or color',
            'Do not add/remove core scene elements between angles',
            'Do not switch to another product or ingredient',
            'Do not apply different stylistic filters per angle',
            'No text overlays, logos generated by AI, or watermark'
        ]
    };
}

function buildConsistentAnglePrompt(params) {
    const {
        identityAnchor,
        sceneBlueprint,
        cameraAngle,
        outputSize,
        additionalNotes,
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

    return composePromptBlocks([
        `## MULTI-ANGLE PRODUCT IMAGE GENERATION (CONSISTENCY MODE)

### GOAL
Generate one image that belongs to the same angle set with high consistency.
- Similarity target with sibling images: 80-90%
- Allowed variation: 10-20% ONLY (camera viewpoint/framing)

### ATTACHED REFERENCE ORDER
${attachedReferences}

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

### HARD NEGATIVE RULES
${negativeRules}

### TECHNICAL REQUIREMENTS
- Aspect ratio: ${sizeInfo.label} (${sizeInfo.width}x${sizeInfo.height})
- Style: Photorealistic professional commercial photography
- Keep natural and coherent shadows with unchanged scene context
- No text, no watermark, no AI-invented branding

### OPTIONAL USER NOTES
${additionalNotes || '(none)'}
${retryInstruction}`,
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
 * Build merged scene prompt using AI to intelligently combine:
 * 1. Product analysis from image
 * 2. Background type selected by user
 * 3. Custom scene description from user
 * 4. Additional notes from user
 * 5. Brand context from AI Settings
 * 
 * @param {Object} params - All context parameters
 * @returns {Promise<string>} AI-generated merged scene description
 */
async function buildMergedScenePrompt(params) {
    const { productAnalysis, backgroundType, cameraAngle, customBackground, outputSize, additionalNotes, brandContext } = params;
    
    const model = getModel('TEXT');
    const sizeInfo = OUTPUT_SIZES[outputSize] || OUTPUT_SIZES['1:1'];
    const backgroundDesc = BACKGROUND_DESCRIPTIONS[backgroundType] || '';
    const angleDescription = CAMERA_ANGLE_PROMPTS[cameraAngle] || CAMERA_ANGLE_PROMPTS.wide;
    
    // Build the context merging prompt
    const mergePrompt = `You are a professional creative director for product photography. Your task is to CREATE A DETAILED SCENE DESCRIPTION that merges all the following inputs into ONE cohesive, specific prompt for an AI image generator.

## INPUT 1: PRODUCT ANALYSIS (from uploaded image)
${JSON.stringify(productAnalysis, null, 2)}

## INPUT 2: BACKGROUND/CONTEXT TYPE SELECTED
Type: "${backgroundType}"
Description: "${backgroundDesc}"

## INPUT 3: USER'S CUSTOM SCENE REQUEST
${customBackground || '(No custom scene specified)'}

## INPUT 4: ADDITIONAL DETAILS FROM USER
${additionalNotes || '(No additional details)'}

## INPUT 5: BRAND CONTEXT (business type, style)
${brandContext || '(No brand context provided)'}

## INPUT 6: CAMERA ANGLE / FRAMING
${cameraAngle || 'wide'} - ${angleDescription}

---

## YOUR TASK

Create a SINGLE, DETAILED scene description that:

1. **PRESERVES PRODUCT IDENTITY**: The product must be recognizable as the EXACT same item from the reference image. Mention specific visual features that must be kept (colors, textures, patterns, distinctive characteristics).

2. **TRANSFORMS THE CONTEXT**: Based on the background type and user's requests, describe how the product should appear in the new scene:
   - If "action" or user mentions "being used/eaten/worn" → Show the product IN ACTION (e.g., steak being cut by a diner, shoes being worn while running)
   - If "lifestyle" → Show realistic usage with people interacting naturally
   - If "kitchen/restaurant" and it's food → Show in appropriate culinary setting

3. **INTEGRATES BRAND CONTEXT**: If brand info is provided (e.g., upscale restaurant, tech company), incorporate appropriate setting elements.

4. **BE EXTREMELY SPECIFIC**: Don't be vague. Describe:
   - WHO is in the scene (if any people)
   - WHAT they are doing with the product
   - WHERE the scene takes place (specific setting details)
   - HOW the product looks (must match original but in new context)
   - CAMERA FRAMING based on requested angle (${cameraAngle || 'wide'})
   - LIGHTING and MOOD

## OUTPUT FORMAT

Return ONLY the scene description, no explanations. The description should be detailed enough that an AI image generator can create exactly what you envision. Output should be 150-300 words.

Example output format:
"A photorealistic image of [specific product description matching original] in [specific scene]. [Person description if applicable] is [action with product]. The setting is [detailed environment description]. [Lighting and mood]. The product maintains its [specific visual features from original - colors, textures, patterns]."`;

    try {
        const result = await model.generateContent(mergePrompt);
        const mergedScene = result.response.text().trim();

        logPromptDebug({
            tool: 'image',
            step: 'prompt-built',
            data: {
                mode: 'scene-merge',
                cameraAngle,
                backgroundType,
                promptPreview: mergePrompt,
                mergedScenePreview: mergedScene
            }
        });
        
        // Build final prompt with the merged scene
        const finalPrompt = `## CREATIVE PRODUCT IMAGE GENERATION

### SCENE TO CREATE
${mergedScene}

### TECHNICAL REQUIREMENTS
- Aspect ratio: ${sizeInfo.label} (${sizeInfo.width}x${sizeInfo.height})
- Camera angle: ${cameraAngle || 'wide'} (${angleDescription})
- Style: Photorealistic, professional photography quality
- Resolution: High quality, sharp details
- NO text, logo, or watermark overlays

### CRITICAL RULES
1. The product in the new image MUST be visually the same as the reference image (same colors, textures, distinctive features)
2. Transform the CONTEXT, not the product's appearance
3. If showing the product in use (cooked food, worn items, etc.), it should still be recognizable as the same product
4. Natural lighting and shadows appropriate to the scene
5. Professional composition and framing`;

        return finalPrompt;
    } catch (error) {
        console.error('buildMergedScenePrompt error:', error);
        // Fallback to simple prompt if AI merge fails
        return buildSimplePrompt(params);
    }
}

/**
 * Fallback simple prompt builder (used if AI merge fails)
 */
function buildSimplePrompt(params) {
    const { productAnalysis, backgroundType, cameraAngle, outputSize } = params;
    const sizeInfo = OUTPUT_SIZES[outputSize] || OUTPUT_SIZES['1:1'];
    const backgroundDesc = BACKGROUND_DESCRIPTIONS[backgroundType] || BACKGROUND_DESCRIPTIONS['studio'];
    const angleDescription = CAMERA_ANGLE_PROMPTS[cameraAngle] || CAMERA_ANGLE_PROMPTS.wide;
    
    return `Create a professional product photo.

PRODUCT: ${productAnalysis.summary || productAnalysis.productType || 'A product'}
BACKGROUND: ${backgroundDesc}
ASPECT RATIO: ${sizeInfo.label}
CAMERA ANGLE: ${cameraAngle || 'wide'} (${angleDescription})

Keep the product exactly as shown in the reference image. Only change the background.
NO logo or text overlays.`;
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
        cameraAngle,
        useLogo,
        logoPosition,
        logoUrl,
        outputSize,
        additionalNotes,
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
        prompt,
        originalPart,
        canonicalPart,
        previousPart
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
                hasBrandContext: !!brandContext
            }
        });

        const productAnalysis = await analyzeProductImage(originalImagePath);

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
            brandContext,
            ...productAnalysis
        });

        const identityAnchor = buildIdentityAnchor(productAnalysis);
        const sceneBlueprint = await buildConsistentSceneBlueprint({
            productAnalysis,
            backgroundType,
            customBackground,
            additionalNotes,
            brandContext
        });

        logPromptDebug({
            tool: 'image',
            step: 'brand-context',
            data: {
                available: !!brandContext,
                preview: brandContext
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
                sceneBlueprint
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
                        cameraAngle,
                        useLogo,
                        logoPosition,
                        logoUrl,
                        outputSize,
                        additionalNotes: angleSpecificNotes,
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
    buildMergedScenePrompt,
    buildSimplePrompt,
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
