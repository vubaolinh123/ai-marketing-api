const jwt = require('jsonwebtoken');
const { User } = require('../models');

// Protect routes - Verify JWT token
const protect = async (req, res, next) => {
    let token;

    // Check Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    // Check if token exists
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Bạn chưa đăng nhập. Vui lòng đăng nhập để truy cập.'
        });
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Get user from token
        req.user = await User.findById(decoded.id);

        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Token không hợp lệ.'
            });
        }

        if (!req.user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'Tài khoản đã bị vô hiệu hóa.'
            });
        }

        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Token không hợp lệ hoặc đã hết hạn.'
        });
    }
};

// Grant access to specific roles
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền truy cập tài nguyên này.'
            });
        }
        next();
    };
};

module.exports = {
    protect,
    authorize
};
