/**
 * Test Script: Video Script API
 * 
 * Tests the Video Script API endpoints including:
 * - Generate script with brand context
 * - Generate random idea
 * - Service functions
 * 
 * Usage: node scripts/test-video-script.js
 */

require('dotenv').config();

const { generateVideoScript, generateRandomIdea } = require('../src/services/gemini/videoScript.service');
const { buildBrandContext } = require('../src/services/gemini/brandContext.service');

// Mock AI Settings based on real user data
const mockAISettings = {
    logo: {
        brandName: 'M-Steakhouse',
        brandIdentity: 'Nhà hàng bít tết cao cấp với phong cách hiện đại',
        resourceLinks: []
    },
    colors: {
        primaryColor: '#372c1b',
        backgroundColor: '#1a1a1a',
        accentColor: '#cacdce'
    },
    language: {
        keywords: ['Bít tết', 'Premium', 'Sang trọng'],
        customerTerm: 'Quý khách'
    },
    tone: {
        overallTone: ['Thân thiện', 'Chuyên nghiệp'],
        contextDescriptions: []
    },
    product: {
        productGroups: ['Đồ Ăn', 'Nhà Hàng'],
        strengths: 'Đội ngũ đầu bếp chuyên nghiệp, nguyên liệu nhập khẩu',
        suitableFor: ['Gia đình', 'Doanh nghiệp']
    }
};

// Mock input data
const mockInput = {
    title: 'Review món bít tết wagyu mới nhất',
    duration: '1p',
    size: 'vertical',
    hasVoiceOver: true,
    otherRequirements: 'Mood năng động, nhịp nhanh',
    ideaMode: 'ai',
    customIdea: ''
};

async function testBuildBrandContext() {
    console.log('\n========================================');
    console.log('TEST 1: Build Brand Context');
    console.log('========================================\n');
    
    const context = buildBrandContext(mockAISettings);
    console.log('Brand Context:');
    console.log('----------------------------------------');
    console.log(context);
    console.log('----------------------------------------\n');
    
    return context;
}

async function testGenerateRandomIdea(brandContext) {
    console.log('\n========================================');
    console.log('TEST 2: Generate Random Idea');
    console.log('========================================\n');
    
    try {
        console.log('Calling AI to generate idea...');
        const idea = await generateRandomIdea(brandContext);
        console.log('✅ Generated Idea:');
        console.log('----------------------------------------');
        console.log(idea);
        console.log('----------------------------------------\n');
        return true;
    } catch (error) {
        console.error('❌ Error:', error.message);
        return false;
    }
}

async function testGenerateVideoScript(brandContext) {
    console.log('\n========================================');
    console.log('TEST 3: Generate Video Script');
    console.log('========================================\n');
    
    console.log('Input:', JSON.stringify(mockInput, null, 2));
    console.log('');
    
    try {
        console.log('Calling AI to generate script...');
        const result = await generateVideoScript({
            input: mockInput,
            brandContext
        });
        
        console.log('✅ Generated Script:');
        console.log('----------------------------------------');
        console.log('Summary:', result.summary);
        console.log('');
        console.log('Scenes:', result.scenes.length);
        result.scenes.forEach((scene, i) => {
            console.log(`  ${i + 1}. [${scene.shotType}] ${scene.location}`);
            console.log(`     ${scene.description.substring(0, 60)}...`);
        });
        console.log('----------------------------------------\n');
        
        // Validate structure
        const hasValidStructure = 
            result.summary && 
            Array.isArray(result.scenes) && 
            result.scenes.length > 0 &&
            result.scenes.every(s => s.sceneNumber && s.description);
            
        console.log('✅ Structure valid:', hasValidStructure);
        return hasValidStructure;
    } catch (error) {
        console.error('❌ Error:', error.message);
        return false;
    }
}

async function runAllTests() {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║   TEST SCRIPT: Video Script API                         ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    
    try {
        // Test 1: Brand context
        const brandContext = await testBuildBrandContext();
        
        // Test 2: Random idea (with API call)
        const ideaResult = await testGenerateRandomIdea(brandContext);
        
        // Test 3: Full script generation
        const scriptResult = await testGenerateVideoScript(brandContext);
        
        console.log('\n========================================');
        console.log('TEST SUMMARY');
        console.log('========================================');
        console.log(`  Brand Context: ✅`);
        console.log(`  Random Idea:   ${ideaResult ? '✅' : '❌'}`);
        console.log(`  Video Script:  ${scriptResult ? '✅' : '❌'}`);
        console.log('========================================\n');
        
        if (ideaResult && scriptResult) {
            console.log('✅ TẤT CẢ TESTS ĐÃ HOÀN THÀNH!\n');
        } else {
            console.log('⚠️ MỘT SỐ TESTS THẤT BẠI\n');
        }
        
    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

runAllTests();
