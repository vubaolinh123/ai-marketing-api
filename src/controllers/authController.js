const mongoose = require('mongoose');
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
const {
    parseClientIp,
    normalizeIp,
    resolveLocationByIp
} = require('../services/deviceLocation.service');
const {
    appendLoginHistory,
    markLoginHistoryRevoked,
    listUserSessions
} = require('../services/sessionDevice.service');

const ACCESS_TOKEN_EXPIRES_IN_SECONDS = Number(process.env.ACCESS_TOKEN_EXPIRES_IN_SECONDS || 15 * 60);
const LOGIN_CONTEXT_GEO_PERMISSION_STATES = new Set(['granted', 'denied', 'prompt', 'unsupported', 'error', 'unknown']);
const MAX_DEVICE_PLATFORM_LENGTH = 120;
const MAX_DEVICE_LANGUAGE_LENGTH = 32;
const MAX_DEVICE_TIMEZONE_LENGTH = 64;
const MAX_DEVICE_SCREEN_LENGTH = 32;

function clampString(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
}

function normalizeDateOrNull(value) {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

function clampNumberOrNull(value, min, max) {
    const num = typeof value === 'number'
        ? value
        : (typeof value === 'string' && value.trim() ? Number(value) : NaN);

    if (!Number.isFinite(num)) return null;
    if (num < min) return min;
    if (num > max) return max;
    return num;
}

function defaultLoginContext() {
    return {
        geoPermissionState: 'unknown',
        browserGeo: {
            latitude: null,
            longitude: null,
            accuracy: null,
            capturedAt: null
        },
        deviceMeta: {
            platform: '',
            language: '',
            timezone: '',
            screen: '',
            deviceMemory: null,
            deviceCores: null
        }
    };
}

function normalizeGeoPermissionState(value) {
    if (typeof value !== 'string') return 'unknown';
    const normalized = value.trim().toLowerCase();
    return LOGIN_CONTEXT_GEO_PERMISSION_STATES.has(normalized) ? normalized : 'unknown';
}

function sanitizeBrowserGeo(value) {
    const defaults = defaultLoginContext().browserGeo;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return defaults;
    }

    return {
        latitude: clampNumberOrNull(value.latitude, -90, 90),
        longitude: clampNumberOrNull(value.longitude, -180, 180),
        accuracy: clampNumberOrNull(value.accuracy, 0, 1000000),
        capturedAt: normalizeDateOrNull(value.capturedAt)
    };
}

function sanitizeDeviceMeta(value) {
    const defaults = defaultLoginContext().deviceMeta;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return defaults;
    }

    const deviceMemory = clampNumberOrNull(value.deviceMemory, 0, 1024);
    const deviceCores = clampNumberOrNull(value.deviceCores, 1, 256);

    let screen = '';
    if (typeof value.screen === 'string') {
        screen = clampString(value.screen, MAX_DEVICE_SCREEN_LENGTH);
    } else if (value.screen && typeof value.screen === 'object' && !Array.isArray(value.screen)) {
        const width = clampNumberOrNull(value.screen.width, 0, 20000);
        const height = clampNumberOrNull(value.screen.height, 0, 20000);
        const pixelRatio = clampNumberOrNull(value.screen.pixelRatio, 0.1, 10);
        if (Number.isFinite(width) && Number.isFinite(height)) {
            const base = `${Math.round(width)}x${Math.round(height)}`;
            screen = clampString(
                Number.isFinite(pixelRatio) ? `${base}@${pixelRatio}` : base,
                MAX_DEVICE_SCREEN_LENGTH
            );
        }
    }

    return {
        platform: clampString(value.platform, MAX_DEVICE_PLATFORM_LENGTH),
        language: clampString(value.language, MAX_DEVICE_LANGUAGE_LENGTH),
        timezone: clampString(value.timezone, MAX_DEVICE_TIMEZONE_LENGTH),
        screen,
        deviceMemory,
        deviceCores: Number.isFinite(deviceCores) ? Math.round(deviceCores) : null
    };
}

function sanitizeLoginContext(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return null;
    }

    return {
        geoPermissionState: normalizeGeoPermissionState(input.geoPermissionState),
        browserGeo: sanitizeBrowserGeo(input.browserGeo),
        deviceMeta: sanitizeDeviceMeta(input.deviceMeta)
    };
}

function loginContextFromSession(session) {
    if (!session) return defaultLoginContext();

    return {
        geoPermissionState: normalizeGeoPermissionState(session.geoPermissionState),
        browserGeo: sanitizeBrowserGeo({
            latitude: session.browserGeoLat,
            longitude: session.browserGeoLng,
            accuracy: session.browserGeoAccuracy,
            capturedAt: session.browserGeoCapturedAt
        }),
        deviceMeta: sanitizeDeviceMeta({
            platform: session.devicePlatform,
            language: session.deviceLanguage,
            timezone: session.deviceTimezone,
            screen: session.deviceScreen,
            deviceMemory: session.deviceMemory,
            deviceCores: session.deviceCores
        })
    };
}

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
    return normalizeIp(parseClientIp(req));
}

function getRequestLocation(req) {
    const ip = getClientIp(req);
    return {
        ip,
        location: resolveLocationByIp(ip)
    };
}

function getCurrentRefreshTokenHash(req) {
    const refreshToken = readRefreshTokenFromRequest(req);
    if (!refreshToken) return '';
    return hashToken(refreshToken);
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

        const { ip: requestIp, location } = getRequestLocation(req);
        const requestLoginContext = sanitizeLoginContext(req.body?.loginContext);
        const loginContext = requestLoginContext || loginContextFromSession(currentSession);
        const newSession = await createRefreshSession({
            userId: user._id,
            rememberMe: currentSession.isRememberMe,
            family: currentSession.family,
            createdByIp: requestIp,
            userAgent: req.headers['user-agent'] || '',
            location,
            geoPermissionState: loginContext.geoPermissionState,
            browserGeo: loginContext.browserGeo,
            deviceMeta: loginContext.deviceMeta
        });

        const revokedAt = new Date();
        currentSession.revokedAt = revokedAt;
        currentSession.replacedByTokenHash = newSession.tokenHash;
        currentSession.lastUsedAt = revokedAt;
        currentSession.lastUsedIp = requestIp;
        currentSession.revokedBy = user._id;
        currentSession.revokeReason = 'refresh-rotated';
        await currentSession.save();

        await markLoginHistoryRevoked(user._id, currentSession._id, 'refresh-rotated', revokedAt);

        await appendLoginHistory(user._id, {
            sessionId: newSession.refreshTokenDoc._id,
            loggedInAt: newSession.refreshTokenDoc.createdAt || new Date(),
            ip: requestIp,
            userAgent: req.headers['user-agent'] || '',
            location,
            geoPermissionState: loginContext.geoPermissionState,
            browserGeo: loginContext.browserGeo,
            deviceMeta: loginContext.deviceMeta,
            revokedAt: null,
            revokeReason: ''
        });

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
            const requestIp = getClientIp(req);
            const tokenDoc = await RefreshToken.findOne({ tokenHash });

            if (tokenDoc) {
                const revokedAt = tokenDoc.revokedAt || new Date();

                if (!tokenDoc.revokedAt) {
                    tokenDoc.revokedAt = revokedAt;
                    tokenDoc.lastUsedAt = revokedAt;
                    tokenDoc.lastUsedIp = requestIp;
                    tokenDoc.revokedBy = tokenDoc.userId;
                    tokenDoc.revokeReason = tokenDoc.revokeReason || 'user-logout';
                    await tokenDoc.save();
                }

                await markLoginHistoryRevoked(
                    tokenDoc.userId,
                    tokenDoc._id,
                    tokenDoc.revokeReason || 'user-logout',
                    revokedAt
                );
            }
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
        const requestIp = getClientIp(req);
        const revokedAt = new Date();

        const activeSessions = await RefreshToken.find({ userId: actor.id, revokedAt: null }).select('_id');

        if (activeSessions.length > 0) {
            await RefreshToken.updateMany(
                { userId: actor.id, revokedAt: null },
                {
                    $set: {
                        revokedAt,
                        lastUsedAt: revokedAt,
                        lastUsedIp: requestIp,
                        revokedBy: actor._id || actor.id,
                        revokeReason: 'user-logout-all'
                    }
                }
            );

            await Promise.all(
                activeSessions.map((session) =>
                    markLoginHistoryRevoked(actor.id, session._id, 'user-logout-all', revokedAt)
                )
            );
        }

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

// @desc    Get own login sessions
// @route   GET /api/auth/sessions
// @access  Private
const getSessions = async (req, res, next) => {
    try {
        const actor = req.actor || req.user;
        const currentTokenHash = getCurrentRefreshTokenHash(req);
        const sessions = await listUserSessions(actor.id, currentTokenHash);

        res.status(200).json({
            success: true,
            message: 'Lấy danh sách phiên đăng nhập thành công',
            data: {
                sessions
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Revoke one own session
// @route   POST /api/auth/sessions/:sessionId/revoke
// @access  Private
const revokeSession = async (req, res, next) => {
    try {
        const actor = req.actor || req.user;
        const { sessionId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(sessionId)) {
            return res.status(400).json({
                success: false,
                message: 'Session ID không hợp lệ'
            });
        }

        const [sessionDoc, hasHistory] = await Promise.all([
            RefreshToken.findById(sessionId),
            User.exists({ _id: actor.id, 'loginHistory.sessionId': String(sessionId) })
        ]);

        if (sessionDoc && String(sessionDoc.userId) !== String(actor.id)) {
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
            sessionDoc.revokeReason = 'user-remote-logout';
            await sessionDoc.save();
        }

        await markLoginHistoryRevoked(
            actor.id,
            sessionId,
            sessionDoc?.revokeReason || 'user-remote-logout',
            revokedAt
        );

        const currentTokenHash = getCurrentRefreshTokenHash(req);
        if (sessionDoc && currentTokenHash && sessionDoc.tokenHash === currentTokenHash) {
            clearRefreshCookie(res);
        }

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

// @desc    Revoke all own sessions except current cookie session
// @route   POST /api/auth/sessions/revoke-others
// @access  Private
const revokeOtherSessions = async (req, res, next) => {
    try {
        const actor = req.actor || req.user;
        const currentTokenHash = getCurrentRefreshTokenHash(req);
        const requestIp = getClientIp(req);
        const revokedAt = new Date();

        const activeSessions = await RefreshToken.find({ userId: actor.id, revokedAt: null }).select('_id tokenHash');
        const sessionsToRevoke = activeSessions.filter((session) => {
            if (!currentTokenHash) return true;
            return session.tokenHash !== currentTokenHash;
        });

        const sessionIds = sessionsToRevoke.map((session) => session._id);

        if (sessionIds.length > 0) {
            await RefreshToken.updateMany(
                { _id: { $in: sessionIds } },
                {
                    $set: {
                        revokedAt,
                        lastUsedAt: revokedAt,
                        lastUsedIp: requestIp,
                        revokedBy: actor._id || actor.id,
                        revokeReason: 'user-logout-other-sessions'
                    }
                }
            );

            await Promise.all(
                sessionIds.map((id) => markLoginHistoryRevoked(actor.id, id, 'user-logout-other-sessions', revokedAt))
            );
        }

        res.status(200).json({
            success: true,
            message: 'Thu hồi các phiên đăng nhập khác thành công',
            data: {
                revokedCount: sessionIds.length
            }
        });
    } catch (error) {
        next(error);
    }
};

// Helper function to create tokens and send response
const sendTokenResponse = async (user, statusCode, res, message, req, rememberMe = false) => {
    const accessToken = user.getSignedJwtToken();
    const { ip: requestIp, location } = getRequestLocation(req);
    const loginContext = sanitizeLoginContext(req.body?.loginContext) || defaultLoginContext();
    const family = generateFamilyId();

    const refreshSession = await createRefreshSession({
        userId: user._id,
        rememberMe,
        family,
        createdByIp: requestIp,
        userAgent: req.headers['user-agent'] || '',
        location,
        geoPermissionState: loginContext.geoPermissionState,
        browserGeo: loginContext.browserGeo,
        deviceMeta: loginContext.deviceMeta
    });

    await appendLoginHistory(user._id, {
        sessionId: refreshSession.refreshTokenDoc._id,
        loggedInAt: refreshSession.refreshTokenDoc.createdAt || new Date(),
        ip: requestIp,
        userAgent: req.headers['user-agent'] || '',
        location,
        geoPermissionState: loginContext.geoPermissionState,
        browserGeo: loginContext.browserGeo,
        deviceMeta: loginContext.deviceMeta,
        revokedAt: null,
        revokeReason: ''
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
    getMe,
    getSessions,
    revokeSession,
    revokeOtherSessions
};
