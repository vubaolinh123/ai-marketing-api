/**
 * Test Script: Article Generation with Brand Context
 * 
 * This script tests the article generation logic with and without brand context.
 * It validates that the dynamic prompt system works correctly.
 * 
 * Usage: node scripts/test-article-generation.js
 */

require('dotenv').config();

const { buildBrandContext, hasBrandData, injectBrandContextToPrompt } = require('../src/services/gemini/brandContext.service');

// Mock AI Settings data (based on real user data)
const mockAISettings = {
    logo: {
        brandName: 'M-Steakhouse',
        logoUrl: '/uploads/images/general/c288007f-78f1-40d3-8902-78e652f7da74.png',
        brandIdentity: 'Màu vàng tượng trưng cho sự ấm cúng. Logo có hình tròn với đầu bò cách điệu, dao và nĩa.',
        resourceLinks: [
            { label: 'Bữa ăn bò sang chảnh', url: 'https://example.com/image.jpg' }
        ]
    },
    colors: {
        primaryColor: '#372c1b',
        backgroundColor: '#1a1a1a',
        accentColor: '#cacdce'
    },
    language: {
        keywords: ['Thực đơn', 'Món ăn', 'Dịch vụ'],
        customerTerm: 'Quý khách'
    },
    tone: {
        overallTone: ['Thân thiện', 'Năng động'],
        contextDescriptions: [
            { context: 'Khi tư vấn khách hàng', description: 'Phải nói với giọng điệu nhẹ nhàng' }
        ]
    },
    product: {
        productGroups: ['Đồ Ăn', 'Nhà Hàng'],
        strengths: 'đội ngũ chuyên nghiệp, công ty lớn được mở lâu năm',
        suitableFor: ['Startup', 'Gia đình']
    }
};

// Test functions
function testBuildBrandContext() {
    console.log('\n========================================');
    console.log('TEST 1: Build Brand Context (ALL fields)');
    console.log('========================================\n');
    
    const context = buildBrandContext(mockAISettings);
    console.log('✅ Brand Context đầy đủ:');
    console.log('----------------------------------------');
    console.log(context);
    console.log('----------------------------------------\n');
    
    // Check all fields are included
    const checks = [
        ['Tên thương hiệu', context.includes('M-Steakhouse')],
        ['Nhận diện thương hiệu', context.includes('Nhận diện thương hiệu')],
        ['Tài nguyên tham khảo', context.includes('Tài nguyên tham khảo')],
        ['Bảng màu thương hiệu', context.includes('Bảng màu thương hiệu')],
        ['Từ khóa thương hiệu', context.includes('Thực đơn')],
        ['Cách xưng hô', context.includes('Quý khách')],
        ['Tone giọng điệu', context.includes('Thân thiện')],
        ['Ngữ cảnh', context.includes('tư vấn khách hàng')],
        ['Nhóm sản phẩm', context.includes('Nhà Hàng')],
        ['Điểm mạnh', context.includes('chuyên nghiệp')],
        ['Phù hợp với', context.includes('Startup')]
    ];
    
    console.log('Kiểm tra các fields:');
    checks.forEach(([name, passed]) => {
        console.log(`  ${passed ? '✓' : '✗'} ${name}`);
    });
    
    const allPassed = checks.every(([, passed]) => passed);
    console.log(`\n→ ${allPassed ? '✅ TẤT CẢ FIELDS ĐỀU CÓ!' : '❌ THIẾU MỘT SỐ FIELDS!'}`);
    
    return context;
}

function testInjectBrandContextToPrompt(brandContext) {
    console.log('\n========================================');
    console.log('TEST 2: Inject Brand Context Helper');
    console.log('========================================\n');
    
    const basePrompt = 'Bạn là chuyên gia viết content. Viết bài về món bít tết.';
    
    // Test with null
    const resultNull = injectBrandContextToPrompt(basePrompt, null);
    console.log('✅ Với brandContext = null:', resultNull === basePrompt ? 'Giữ nguyên (đúng)' : 'Sai');
    
    // Test with brand context
    const resultWithBrand = injectBrandContextToPrompt(basePrompt, brandContext);
    const hasHeader = resultWithBrand.includes('THÔNG TIN THƯƠNG HIỆU');
    const hasBrandName = resultWithBrand.includes('M-Steakhouse');
    const hasGuidelines = resultWithBrand.includes('Hướng dẫn sử dụng');
    const hasNoPlaceholder = resultWithBrand.includes('KHÔNG dùng placeholder');
    
    console.log('✅ Với brandContext:');
    console.log(`  ${hasHeader ? '✓' : '✗'} Có header "THÔNG TIN THƯƠNG HIỆU"`);
    console.log(`  ${hasBrandName ? '✓' : '✗'} Có tên thương hiệu "M-Steakhouse"`);
    console.log(`  ${hasGuidelines ? '✓' : '✗'} Có "Hướng dẫn sử dụng"`);
    console.log(`  ${hasNoPlaceholder ? '✓' : '✗'} Có yêu cầu "KHÔNG dùng placeholder"`);
    
    console.log(`\n→ ${hasHeader && hasBrandName && hasGuidelines && hasNoPlaceholder ? '✅ INJECT THÀNH CÔNG!' : '❌ CÓ LỖI!'}`);
}

function testHasBrandData() {
    console.log('\n========================================');
    console.log('TEST 3: Has Brand Data Check');
    console.log('========================================\n');
    
    const tests = [
        ['Full settings', mockAISettings, true],
        ['Empty object', {}, false],
        ['Null', null, false],
        ['Only brandName', { logo: { brandName: 'Test' } }, true],
        ['Only colors', { colors: { primaryColor: '#000' } }, true]
    ];
    
    tests.forEach(([name, data, expected]) => {
        const result = hasBrandData(data);
        const passed = result === expected;
        console.log(`  ${passed ? '✓' : '✗'} ${name}: ${result} (expected: ${expected})`);
    });
}

// Run all tests
async function runAllTests() {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║   TEST SCRIPT: Brand Context with ALL Fields            ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    
    try {
        const brandContext = testBuildBrandContext();
        testInjectBrandContextToPrompt(brandContext);
        testHasBrandData();
        
        console.log('\n========================================');
        console.log('✅ TẤT CẢ TESTS ĐÃ HOÀN THÀNH!');
        console.log('========================================\n');
        
    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

runAllTests();
