const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { RefreshToken } = require('../models');

const REFRESH_COOKIE_NAME = process.env.REFRESH_TOKEN_COOKIE_NAME || 'refresh_token';
const REFRESH_DEFAULT_EXPIRE_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRE_DAYS || 90);
const REFRESH_REMEMBER_EXPIRE_DAYS = Number(process.env.REFRESH_TOKEN_REMEMBER_EXPIRE_DAYS || 365);

function getRefreshExpireDays(rememberMe) {
    return rememberMe ? REFRESH_REMEMBER_EXPIRE_DAYS : REFRESH_DEFAULT_EXPIRE_DAYS;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function generateFamilyId() {
    return crypto.randomUUID();
}

function signRefreshToken(payload, rememberMe = false) {
    const expiresInDays = getRefreshExpireDays(rememberMe);

    return jwt.sign(payload, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
        expiresIn: `${expiresInDays}d`
    });
}

function verifyRefreshToken(token) {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
}

function buildRefreshCookieOptions(rememberMe) {
    const secure = process.env.NODE_ENV === 'production';
    const expiresInDays = getRefreshExpireDays(rememberMe);

    const options = {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/api/auth/refresh',
        maxAge: expiresInDays * 24 * 60 * 60 * 1000
    };

    return options;
}

function setRefreshCookie(res, token, rememberMe) {
    res.cookie(REFRESH_COOKIE_NAME, token, buildRefreshCookieOptions(rememberMe));
}

function clearRefreshCookie(res) {
    res.clearCookie(REFRESH_COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/auth/refresh'
    });
}

function readRefreshTokenFromRequest(req) {
    return req.cookies?.[REFRESH_COOKIE_NAME] || null;
}

function computeExpiresAt(rememberMe) {
    const expiresInDays = getRefreshExpireDays(rememberMe);
    return new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
}

async function createRefreshSession({ userId, rememberMe, family, createdByIp, userAgent }) {
    const tokenId = crypto.randomUUID();
    const token = signRefreshToken({ id: userId, jti: tokenId, family }, rememberMe);
    const tokenHash = hashToken(token);

    const refreshTokenDoc = await RefreshToken.create({
        userId,
        tokenHash,
        family,
        isRememberMe: !!rememberMe,
        expiresAt: computeExpiresAt(rememberMe),
        createdByIp: createdByIp || '',
        userAgent: userAgent || ''
    });

    return {
        token,
        tokenHash,
        refreshTokenDoc
    };
}

module.exports = {
    REFRESH_COOKIE_NAME,
    REFRESH_DEFAULT_EXPIRE_DAYS,
    REFRESH_REMEMBER_EXPIRE_DAYS,
    hashToken,
    generateFamilyId,
    signRefreshToken,
    verifyRefreshToken,
    buildRefreshCookieOptions,
    setRefreshCookie,
    clearRefreshCookie,
    readRefreshTokenFromRequest,
    createRefreshSession
};
