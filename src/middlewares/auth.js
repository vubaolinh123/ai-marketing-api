const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { User } = require('../models');

const IMPERSONATION_HEADER = 'x-act-as-user';
const IMPERSONATION_ALLOWED_PREFIXES = [
    '/api/ai-settings',
    '/api/articles',
    '/api/upload',
    '/api/ai',
    '/api/video-scripts',
    '/api/product-images',
    '/api/marketing-plan'
];

function readActAsUserId(req) {
    const value = req.headers?.[IMPERSONATION_HEADER];

    if (Array.isArray(value)) {
        return String(value[0] || '').trim();
    }

    if (typeof value === 'string') {
        return value.trim();
    }

    return '';
}

function isImpersonationAllowed(req) {
    const requestPath = req.originalUrl || req.url || '';
    return IMPERSONATION_ALLOWED_PREFIXES.some((prefix) => requestPath.startsWith(prefix));
}

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

        // Get actor (real authenticated user) from token
        const actor = await User.findById(decoded.id);

        if (!actor) {
            return res.status(401).json({
                success: false,
                message: 'Token không hợp lệ.'
            });
        }

        if (!actor.isActive) {
            return res.status(401).json({
                success: false,
                message: 'Tài khoản đã bị vô hiệu hóa.'
            });
        }

        req.actor = actor;
        req.user = actor;
        req.isImpersonating = false;

        // Optional admin impersonation via header
        const actAsUserId = readActAsUserId(req);
        if (actAsUserId) {
            if (!isImpersonationAllowed(req)) {
                return res.status(400).json({
                    success: false,
                    message: 'Ngữ cảnh chuyển người dùng không áp dụng cho API này.'
                });
            }

            if (actor.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Chỉ admin mới có thể chuyển ngữ cảnh người dùng.'
                });
            }

            if (!mongoose.Types.ObjectId.isValid(actAsUserId)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID người dùng cần chuyển ngữ cảnh không hợp lệ.'
                });
            }

            if (String(actor._id) !== actAsUserId) {
                const effectiveUser = await User.findById(actAsUserId);

                if (!effectiveUser) {
                    return res.status(404).json({
                        success: false,
                        message: 'Không tìm thấy người dùng để chuyển ngữ cảnh.'
                    });
                }

                if (!effectiveUser.isActive) {
                    return res.status(403).json({
                        success: false,
                        message: 'Không thể chuyển ngữ cảnh sang tài khoản đã bị vô hiệu hóa.'
                    });
                }

                req.user = effectiveUser;
                req.isImpersonating = true;
            }
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
        const principal = req.actor || req.user;

        if (!principal || !roles.includes(principal.role)) {
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
