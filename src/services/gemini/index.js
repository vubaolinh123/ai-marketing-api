/**
 * Gemini Services Index
 * Re-exports all Gemini AI services for easy import
 */

const { generateArticleContent } = require('./articleText.service');
const { generateArticleWithImage } = require('./articleVision.service');
const { generateImage, generateArticleWithAIImage } = require('./imageGen.service');
const { analyzeImage, analyzeImageUrl } = require('./imageAnalysis.service');
const { buildBrandContext, hasBrandData, injectBrandContextToPrompt } = require('./brandContext.service');
const { generateVideoScript, generateRandomIdea } = require('./videoScript.service');
const { generateMarketingPlan } = require('./marketingPlan.service');
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
    hasBrandData,
    injectBrandContextToPrompt,
    
    // Video script
    generateVideoScript,
    generateRandomIdea,
    
    // Marketing plan
    generateMarketingPlan,
    
    // Product image
    productImageService,
    
    // Model config
    modelConfigService
};

