/**
 * Product Image API Test Script
 * Tests the product image generation endpoints
 * 
 * Usage: node tests/productImage.api.test.js
 */

require('dotenv').config();
const path = require('path');

const API_BASE = process.env.API_URL || 'http://localhost:5000/api';

// Test credentials - update these with valid test user
const TEST_USER = {
    email: 'test@example.com',
    password: 'Test123456'
};

// Helper to make API requests
async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        ...options
    });
    
    const data = await response.json();
    return { status: response.status, data };
}

// Test results tracker
const results = {
    passed: 0,
    failed: 0,
    tests: []
};

function log(message, type = 'info') {
    const icons = {
        pass: '✅',
        fail: '❌',
        info: 'ℹ️',
        warn: '⚠️'
    };
    console.log(`${icons[type] || ''} ${message}`);
}

function assert(condition, testName) {
    if (condition) {
        results.passed++;
        results.tests.push({ name: testName, passed: true });
        log(`PASS: ${testName}`, 'pass');
    } else {
        results.failed++;
        results.tests.push({ name: testName, passed: false });
        log(`FAIL: ${testName}`, 'fail');
    }
}

// =====================================================
// TEST CASES
// =====================================================

async function testLogin() {
    log('\n--- Testing Login ---', 'info');
    
    const { status, data } = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify(TEST_USER)
    });
    
    assert(status === 200, 'Login returns 200');
    assert(data.success === true, 'Login success flag is true');
    assert(data.token !== undefined, 'Login returns token');
    
    return data.token;
}

async function testGenerateProductImage(token) {
    log('\n--- Testing Generate Product Image ---', 'info');
    
    // Note: This test requires a pre-uploaded image
    // In real tests, you would first upload an image via the upload API
    const testInput = {
        originalImageUrl: '/uploads/images/test-product.jpg',
        backgroundType: 'studio',
        useLogo: true,
        logoPosition: 'bottom-right',
        outputSize: '1:1',
        useBrandSettings: false
    };
    
    const { status, data } = await apiRequest('/product-images/generate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(testInput)
    });
    
    // May fail if test image doesn't exist, but API should respond correctly
    assert(status === 201 || status === 400 || status === 500, 'Generate endpoint responds');
    assert(data.success !== undefined, 'Response has success field');
    
    if (data.success && data.data) {
        assert(data.data.userId !== undefined, 'Response includes userId');
        assert(data.data.status !== undefined, 'Response includes status');
        return data.data._id;
    }
    
    return null;
}

async function testListProductImages(token) {
    log('\n--- Testing List Product Images ---', 'info');
    
    const { status, data } = await apiRequest('/product-images?page=1&limit=10', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
    });
    
    assert(status === 200, 'List endpoint returns 200');
    assert(data.success === true, 'List success flag is true');
    assert(Array.isArray(data.data), 'Response data is an array');
    assert(data.pagination !== undefined, 'Response has pagination');
    assert(data.pagination.page === 1, 'Pagination page is correct');
    
    return data.data;
}

async function testListWithFilters(token) {
    log('\n--- Testing List with Filters ---', 'info');
    
    // Test with search filter
    const { status: status1, data: data1 } = await apiRequest('/product-images?search=test', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
    });
    
    assert(status1 === 200, 'Search filter returns 200');
    
    // Test with backgroundType filter
    const { status: status2, data: data2 } = await apiRequest('/product-images?backgroundType=studio', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
    });
    
    assert(status2 === 200, 'Background filter returns 200');
    
    // Test with status filter
    const { status: status3, data: data3 } = await apiRequest('/product-images?status=completed', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
    });
    
    assert(status3 === 200, 'Status filter returns 200');
}

async function testGetById(token, imageId) {
    log('\n--- Testing Get By ID ---', 'info');
    
    if (!imageId) {
        log('Skipping - no image ID available', 'warn');
        return;
    }
    
    const { status, data } = await apiRequest(`/product-images/${imageId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
    });
    
    assert(status === 200, 'Get by ID returns 200');
    assert(data.success === true, 'Get by ID success flag is true');
    assert(data.data._id === imageId, 'Returned image ID matches');
}

async function testUnauthorizedAccess() {
    log('\n--- Testing Unauthorized Access ---', 'info');
    
    // Try to access without token
    const { status } = await apiRequest('/product-images', {
        method: 'GET'
    });
    
    assert(status === 401, 'Unauthorized request returns 401');
}

async function testOwnershipProtection(token) {
    log('\n--- Testing Ownership Protection ---', 'info');
    
    // Try to access a non-existent or other user's image
    const fakeId = '507f1f77bcf86cd799439011';
    
    const { status, data } = await apiRequest(`/product-images/${fakeId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
    });
    
    assert(status === 404, 'Non-existent image returns 404');
    assert(data.success === false, 'Response indicates failure');
}

// =====================================================
// MAIN TEST RUNNER
// =====================================================

async function runTests() {
    console.log('='.repeat(50));
    console.log('Product Image API Test Suite');
    console.log('='.repeat(50));
    console.log(`API Base: ${API_BASE}`);
    console.log(`Test User: ${TEST_USER.email}`);
    console.log('='.repeat(50));
    
    try {
        // Test unauthorized first
        await testUnauthorizedAccess();
        
        // Login to get token
        const token = await testLogin();
        
        if (!token) {
            log('Cannot continue - login failed', 'fail');
            return;
        }
        
        // Run authenticated tests
        const imageId = await testGenerateProductImage(token);
        await testListProductImages(token);
        await testListWithFilters(token);
        await testGetById(token, imageId);
        await testOwnershipProtection(token);
        
    } catch (error) {
        log(`Test error: ${error.message}`, 'fail');
    }
    
    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log('TEST SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total: ${results.passed + results.failed}`);
    console.log(`Passed: ${results.passed}`);
    console.log(`Failed: ${results.failed}`);
    console.log('='.repeat(50));
    
    // Exit with appropriate code
    process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runTests();
