const { User, RefreshToken } = require('../models');
const {
    generateFamilyId,
    verifyRefreshToken,
    hashToken,
    setRefreshCookie,
    clearRefreshCookie,
    readRefreshTokenFromRequest,
    createRefreshSession,
    REFRESH_DEFAULT_EXPIRE_DAYS,
    REFRESH_REMEMBER_EXPIRE_DAYS
} = require('../utils/refreshToken');

const ACCESS_TOKEN_EXPIRES_IN_SECONDS = Number(process.env.ACCESS_TOKEN_EXPIRES_IN_SECONDS || 15 * 60);

function toSafeUser(user) {
    return {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role
    };
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }

    return req.ip || req.socket?.remoteAddress || '';
}

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res, next) => {
    try {
        const { name, email, password, rememberMe = false } = req.body;

        // Create user
        const user = await User.create({
            name,
            email,
            password
        });

        // Create token and send response
        await sendTokenResponse(user, 201, res, 'Đăng ký thành công', req, !!rememberMe);
    } catch (error) {
        next(error);
    }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res, next) => {
    try {
        const { email, password, rememberMe = false } = req.body;

        // Validate email & password
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập email và mật khẩu'
            });
        }

        // Check for user
        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Email hoặc mật khẩu không đúng'
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'Tài khoản đã bị vô hiệu hóa'
            });
        }

        // Check if password matches
        const isMatch = await user.matchPassword(password);

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Email hoặc mật khẩu không đúng'
            });
        }

        // Create token and send response
        await sendTokenResponse(user, 200, res, 'Đăng nhập thành công', req, !!rememberMe);
    } catch (error) {
        next(error);
    }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public (refresh-cookie based)
const refresh = async (req, res, next) => {
    try {
        const refreshToken = readRefreshTokenFromRequest(req);

        if (!refreshToken) {
            clearRefreshCookie(res);
            return res.status(401).json({
                success: false,
                message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
            });
        }

        let decoded;
        try {
            decoded = verifyRefreshToken(refreshToken);
        } catch (_error) {
            clearRefreshCookie(res);
            return res.status(401).json({
                success: false,
                message: 'Refresh token không hợp lệ hoặc đã hết hạn.'
            });
        }

        const incomingHash = hashToken(refreshToken);
        const currentSession = await RefreshToken.findOne({ tokenHash: incomingHash });

        if (!currentSession) {
            if (decoded?.id && decoded?.family) {
                await RefreshToken.updateMany(
                    { userId: decoded.id, family: decoded.family, revokedAt: null },
                    { $set: { revokedAt: new Date() } }
                );
            }

            clearRefreshCookie(res);
            return res.status(401).json({
                success: false,
                message: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.'
            });
        }

        if (currentSession.revokedAt) {
            await RefreshToken.updateMany(
                { userId: currentSession.userId, family: currentSession.family, revokedAt: null },
                { $set: { revokedAt: new Date() } }
            );

            clearRefreshCookie(res);
            return res.status(401).json({
                success: false,
                message: 'Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.'
            });
        }

        if (currentSession.expiresAt && currentSession.expiresAt < new Date()) {
            currentSession.revokedAt = new Date();
            await currentSession.save();
            clearRefreshCookie(res);

            return res.status(401).json({
                success: false,
                message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
            });
        }

        const user = await User.findById(currentSession.userId);
        if (!user || !user.isActive) {
            await RefreshToken.updateMany(
                { userId: currentSession.userId, family: currentSession.family, revokedAt: null },
                { $set: { revokedAt: new Date() } }
            );

            clearRefreshCookie(res);
            return res.status(401).json({
                success: false,
                message: 'Tài khoản không còn hợp lệ. Vui lòng đăng nhập lại.'
            });
        }

        const requestIp = getClientIp(req);
        const newSession = await createRefreshSession({
            userId: user._id,
            rememberMe: currentSession.isRememberMe,
            family: currentSession.family,
            createdByIp: requestIp,
            userAgent: req.headers['user-agent'] || ''
        });

        currentSession.revokedAt = new Date();
        currentSession.replacedByTokenHash = newSession.tokenHash;
        currentSession.lastUsedAt = new Date();
        currentSession.lastUsedIp = requestIp;
        await currentSession.save();

        setRefreshCookie(res, newSession.token, currentSession.isRememberMe);

        const accessToken = user.getSignedJwtToken();

        res.status(200).json({
            success: true,
            message: 'Làm mới phiên đăng nhập thành công',
            data: {
                token: accessToken,
                expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
                refreshExpiresInDays: currentSession.isRememberMe
                    ? REFRESH_REMEMBER_EXPIRE_DAYS
                    : REFRESH_DEFAULT_EXPIRE_DAYS,
                user: toSafeUser(user)
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Logout user (revoke refresh session)
// @route   POST /api/auth/logout
// @access  Public (uses refresh-cookie when available)
const logout = async (req, res, next) => {
    try {
        const refreshToken = readRefreshTokenFromRequest(req);

        if (refreshToken) {
            const tokenHash = hashToken(refreshToken);
            await RefreshToken.findOneAndUpdate(
                { tokenHash, revokedAt: null },
                {
                    $set: {
                        revokedAt: new Date(),
                        lastUsedAt: new Date(),
                        lastUsedIp: getClientIp(req)
                    }
                }
            );
        }

        clearRefreshCookie(res);

        res.status(200).json({
            success: true,
            message: 'Đăng xuất thành công',
            data: {}
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res, next) => {
    try {
        const actor = req.actor || req.user;
        const user = await User.findById(actor.id);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Tài khoản không còn tồn tại.'
            });
        }

        res.status(200).json({
            success: true,
            data: {
                ...user.toObject(),
                effectiveUser: req.isImpersonating
                    ? {
                        id: req.user._id,
                        name: req.user.name,
                        email: req.user.email,
                        avatar: req.user.avatar,
                        role: req.user.role
                    }
                    : null,
                isImpersonating: !!req.isImpersonating
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Logout all sessions for current user
// @route   POST /api/auth/logout-all
// @access  Private
const logoutAll = async (req, res, next) => {
    try {
        const actor = req.actor || req.user;

        await RefreshToken.updateMany(
            { userId: actor.id, revokedAt: null },
            {
                $set: {
                    revokedAt: new Date(),
                    lastUsedAt: new Date(),
                    lastUsedIp: getClientIp(req)
                }
            }
        );

        clearRefreshCookie(res);

        res.status(200).json({
            success: true,
            message: 'Đăng xuất toàn bộ thiết bị thành công',
            data: {}
        });
    } catch (error) {
        next(error);
    }
};

// Helper function to create tokens and send response
const sendTokenResponse = async (user, statusCode, res, message, req, rememberMe = false) => {
    const accessToken = user.getSignedJwtToken();
    const requestIp = getClientIp(req);
    const family = generateFamilyId();

    const refreshSession = await createRefreshSession({
        userId: user._id,
        rememberMe,
        family,
        createdByIp: requestIp,
        userAgent: req.headers['user-agent'] || ''
    });

    setRefreshCookie(res, refreshSession.token, rememberMe);

    res.status(statusCode).json({
        success: true,
        message,
        data: {
            token: accessToken,
            expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
            rememberMe: !!rememberMe,
            refreshExpiresInDays: rememberMe
                ? REFRESH_REMEMBER_EXPIRE_DAYS
                : REFRESH_DEFAULT_EXPIRE_DAYS,
            user: toSafeUser(user)
        }
    });
};

module.exports = {
    register,
    login,
    refresh,
    logout,
    logoutAll,
    getMe
};
