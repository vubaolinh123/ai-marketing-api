const { User, RefreshToken } = require('../models');

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
