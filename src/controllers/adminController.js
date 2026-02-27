const mongoose = require('mongoose');
const { User, RefreshToken } = require('../models');
const tokenUsageService = require('../services/tokenUsage.service');
const { hashToken, readRefreshTokenFromRequest } = require('../utils/refreshToken');
const {
    listUserSessions,
    markLoginHistoryRevoked
} = require('../services/sessionDevice.service');
const { parseClientIp, normalizeIp } = require('../services/deviceLocation.service');

function getClientIp(req) {
    return normalizeIp(parseClientIp(req));
}

function setNoCacheHeaders(res) {
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        Pragma: 'no-cache',
        Expires: '0'
    });
}

function toSafeUserPayload(user) {
    if (!user) return null;

    return {
        id: String(user._id),
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
    };
}

function buildUserFilters(query = {}) {
    const filter = {};

    if (query.role && ['admin', 'user'].includes(query.role)) {
        filter.role = query.role;
    }

    if (query.status === 'active') {
        filter.isActive = true;
    } else if (query.status === 'inactive') {
        filter.isActive = false;
    }

    if (query.search && String(query.search).trim()) {
        const search = String(query.search).trim();
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } }
        ];
    }

    return filter;
}

// @desc    Admin: list users
// @route   GET /api/admin/users
// @access  Private (admin)
exports.listUsers = async (req, res, next) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
        const skip = (page - 1) * limit;

        const filter = buildUserFilters(req.query);

        const [users, total, activeCount, inactiveCount, adminCount, totalCount] = await Promise.all([
            User.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            User.countDocuments(filter),
            User.countDocuments({ isActive: true }),
            User.countDocuments({ isActive: false }),
            User.countDocuments({ role: 'admin' }),
            User.countDocuments({})
        ]);

        const normalizedUsers = users.map(toSafeUserPayload);
        const stats = {
            total: totalCount,
            active: activeCount,
            inactive: inactiveCount,
            admins: adminCount
        };

        res.status(200).json({
            success: true,
            data: {
                users: normalizedUsers,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                },
                stats
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin: create user
// @route   POST /api/admin/users
// @access  Private (admin)
exports.createUser = async (req, res, next) => {
    try {
        const { name, email, password, role = 'user', isActive = true } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập đầy đủ tên, email và mật khẩu'
            });
        }

        if (!['admin', 'user'].includes(role)) {
            return res.status(400).json({
                success: false,
                message: 'Role không hợp lệ. Chỉ chấp nhận admin hoặc user.'
            });
        }

        const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Email đã tồn tại'
            });
        }

        const user = await User.create({
            name,
            email,
            password,
            role,
            isActive
        });

        res.status(201).json({
            success: true,
            message: 'Tạo tài khoản thành công',
            data: toSafeUserPayload(user)
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin: update user (name, role, status)
// @route   PATCH /api/admin/users/:id
// @access  Private (admin)
exports.updateUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, role, isActive } = req.body;

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }

        const actor = req.actor || req.user;
        if (String(user._id) === String(actor._id)) {
            if (role && role !== user.role) {
                return res.status(400).json({
                    success: false,
                    message: 'Không thể tự thay đổi role của chính mình qua API này.'
                });
            }

            if (typeof isActive === 'boolean' && isActive === false) {
                return res.status(400).json({
                    success: false,
                    message: 'Không thể tự vô hiệu hóa tài khoản admin hiện tại.'
                });
            }
        }

        const updateData = {};
        if (typeof name === 'string') updateData.name = name;

        if (role !== undefined) {
            if (!['admin', 'user'].includes(role)) {
                return res.status(400).json({
                    success: false,
                    message: 'Role không hợp lệ. Chỉ chấp nhận admin hoặc user.'
                });
            }
            updateData.role = role;
        }

        if (typeof isActive === 'boolean') {
            updateData.isActive = isActive;
        }

        const updated = await User.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        res.status(200).json({
            success: true,
            message: 'Cập nhật người dùng thành công',
            data: toSafeUserPayload(updated)
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin: delete user
// @route   DELETE /api/admin/users/:id
// @access  Private (admin)
exports.deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }

        const actor = req.actor || req.user;
        if (String(user._id) === String(actor._id)) {
            return res.status(400).json({
                success: false,
                message: 'Không thể tự xóa tài khoản của chính mình.'
            });
        }

        if (user.role === 'admin') {
            const adminCount = await User.countDocuments({ role: 'admin' });
            if (adminCount <= 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Không thể xóa admin cuối cùng trong hệ thống.'
                });
            }
        }

        await RefreshToken.deleteMany({ userId: user._id });
        await User.deleteOne({ _id: user._id });

        res.status(200).json({
            success: true,
            message: 'Xóa người dùng thành công'
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin: reset user password
// @route   PATCH /api/admin/users/:id/password
// @access  Private (admin)
exports.resetUserPassword = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || String(newPassword).length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Mật khẩu mới phải có ít nhất 6 ký tự'
            });
        }

        const user = await User.findById(id).select('+password');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }

        user.password = newPassword;
        await user.save();

        await RefreshToken.updateMany(
            { userId: user._id, revokedAt: null },
            { $set: { revokedAt: new Date() } }
        );

        res.status(200).json({
            success: true,
            message: 'Đặt lại mật khẩu thành công'
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin: list users for switch context dropdown
// @route   GET /api/admin/impersonation-targets
// @access  Private (admin)
exports.getImpersonationTargets = async (req, res, next) => {
    try {
        const actor = req.actor || req.user;
        const search = String(req.query.search || '').trim();
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

        const filter = { isActive: true, _id: { $ne: actor._id } };

        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const users = await User.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit);

        res.status(200).json({
            success: true,
            data: users.map(toSafeUserPayload)
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin: token usage summary
// @route   GET /api/admin/token-usage/summary
// @access  Private (admin)
exports.getTokenUsageSummary = async (req, res, next) => {
    try {
        const data = await tokenUsageService.getTokenUsageSummary({
            from: req.query.from,
            to: req.query.to,
            groupBy: req.query.groupBy,
            userId: req.query.userId || null,
            limitUsers: req.query.limitUsers
        });

        setNoCacheHeaders(res);

        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin: token usage by users (paginated)
// @route   GET /api/admin/token-usage/users
// @access  Private (admin)
exports.getTokenUsageUsers = async (req, res, next) => {
    try {
        const data = await tokenUsageService.getTokenUsageUsers({
            from: req.query.from,
            to: req.query.to,
            page: req.query.page,
            limit: req.query.limit,
            search: req.query.search,
            userId: req.query.userId || null
        });

        setNoCacheHeaders(res);

        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin: token usage debug recent records
// @route   GET /api/admin/token-usage/debug/recent
// @access  Private (admin)
exports.getTokenUsageDebugRecent = async (req, res, next) => {
    try {
        const data = await tokenUsageService.getRecentTokenUsageDebug({
            limit: req.query.limit
        });

        setNoCacheHeaders(res);

        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin: get sessions of a user
// @route   GET /api/admin/users/:id/sessions
// @access  Private (admin)
exports.getUserSessions = async (req, res, next) => {
    try {
        const { id } = req.params;
        const includeRevoked = String(req.query.includeRevoked || '').trim().toLowerCase() === 'true';

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'ID người dùng không hợp lệ'
            });
        }

        const targetUser = await User.findById(id).select('_id');
        if (!targetUser) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }

        const refreshToken = readRefreshTokenFromRequest(req);
        const currentTokenHash = refreshToken ? hashToken(refreshToken) : '';
        const sessions = await listUserSessions(id, currentTokenHash, { includeRevoked });

        res.status(200).json({
            success: true,
            message: 'Lấy danh sách phiên đăng nhập thành công',
            data: {
                sessions,
                activeSessions: sessions,
                loginHistory: sessions
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin: revoke one session of a user
// @route   POST /api/admin/users/:id/sessions/:sessionId/revoke
// @access  Private (admin)
exports.revokeUserSession = async (req, res, next) => {
    try {
        const actor = req.actor || req.user;
        const { id, sessionId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'ID người dùng không hợp lệ'
            });
        }

        if (!mongoose.Types.ObjectId.isValid(sessionId)) {
            return res.status(400).json({
                success: false,
                message: 'Session ID không hợp lệ'
            });
        }

        const targetUser = await User.findById(id).select('_id');
        if (!targetUser) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }

        const [sessionDoc, hasHistory] = await Promise.all([
            RefreshToken.findById(sessionId),
            User.exists({ _id: id, 'loginHistory.sessionId': String(sessionId) })
        ]);

        if (sessionDoc && String(sessionDoc.userId) !== String(id)) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy phiên đăng nhập'
            });
        }

        if (!sessionDoc && !hasHistory) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy phiên đăng nhập'
            });
        }

        const requestIp = getClientIp(req);
        const revokedAt = sessionDoc?.revokedAt || new Date();

        if (sessionDoc && !sessionDoc.revokedAt) {
            sessionDoc.revokedAt = revokedAt;
            sessionDoc.lastUsedAt = revokedAt;
            sessionDoc.lastUsedIp = requestIp;
            sessionDoc.revokedBy = actor._id || actor.id;
            sessionDoc.revokeReason = 'admin-force-logout';
            await sessionDoc.save();
        }

        await markLoginHistoryRevoked(
            id,
            sessionId,
            sessionDoc?.revokeReason || 'admin-force-logout',
            revokedAt
        );

        res.status(200).json({
            success: true,
            message: 'Thu hồi phiên đăng nhập thành công',
            data: {
                sessionId: String(sessionId)
            }
        });
    } catch (error) {
        next(error);
    }
};
