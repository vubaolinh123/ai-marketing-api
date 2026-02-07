/**
 * Script tạo tài khoản admin
 * Chạy: node create-admin.js
 */

const http = require('http');

const adminUser = {
    name: 'Linh',
    email: 'linh@gmail.com',
    password: 'linh@123'
};

const data = JSON.stringify(adminUser);

const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/register',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
    }
};

console.log('🚀 Đang tạo tài khoản admin...');
console.log(`   Email: ${adminUser.email}`);
console.log(`   Password: ${adminUser.password}`);

const req = http.request(options, (res) => {
    let responseData = '';
    
    res.on('data', (chunk) => {
        responseData += chunk;
    });
    
    res.on('end', () => {
        try {
            const result = JSON.parse(responseData);
            
            if (result.success) {
                console.log('\n✅ Tạo tài khoản thành công!');
                console.log(`   User ID: ${result.data.user.id}`);
                console.log(`   Role: ${result.data.user.role}`);
                console.log('\n📌 Bây giờ cần update role thành admin trong database');
            } else {
                console.log('\n❌ Lỗi:', result.message);
            }
        } catch (e) {
            console.error('Parse error:', e);
            console.log('Raw response:', responseData);
        }
    });
});

req.on('error', (e) => {
    console.error(`\n❌ Lỗi kết nối: ${e.message}`);
    console.log('⚠️  Hãy chắc chắn backend đang chạy trên port 5000');
});

req.write(data);
req.end();
