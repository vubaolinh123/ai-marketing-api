/**
 * Gemini Services Index
 * Re-exports all Gemini AI services for easy import
 */

const { generateArticleContent } = require('./articleText.service');
const { generateArticleWithImage } = require('./articleVision.service');
const { generateImage, generateArticleWithAIImage } = require('./imageGen.service');
const { analyzeImage, analyzeImageUrl } = require('./imageAnalysis.service');
const { buildBrandContext, buildRichBrandContext, hasBrandData, injectBrandContextToPrompt } = require('./brandContext.service');
const { generateVideoScript, generateRandomIdea, suggestVideoConcepts } = require('./videoScript.service');
const { generateMarketingPlan, generateMonthlyStrategy } = require('./marketingPlan.service');
const productImageService = require('./productImage.service');
const modelConfigService = require('./modelConfig.service');

module.exports = {
    // Text generation
    generateArticleContent,
    
    // Vision (image analysis)
    generateArticleWithImage,
    
    // Image generation
    generateImage,
    generateArticleWithAIImage,
    
    // Image analysis
    analyzeImage,
    analyzeImageUrl,
    
    // Brand context
    buildBrandContext,
    buildRichBrandContext,
    hasBrandData,
    injectBrandContextToPrompt,
    
    // Video script
    generateVideoScript,
    generateRandomIdea,
    suggestVideoConcepts,
    
    // Marketing plan
    generateMarketingPlan,
    generateMonthlyStrategy,
    
    // Product image
    productImageService,
    
    // Model config
    modelConfigService
};

