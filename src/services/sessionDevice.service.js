const { User, RefreshToken } = require('../models');

function normalizeLocation(location = {}) {
    return {
        country: location.country || '',
        region: location.region || '',
        city: location.city || '',
        timezone: location.timezone || '',
        source: location.source || ''
    };
}

function normalizeGeoPermissionState(state) {
    const allowed = new Set(['granted', 'denied', 'prompt', 'unsupported', 'error', 'unknown']);
    const normalized = typeof state === 'string' ? state.toLowerCase() : 'unknown';
    return allowed.has(normalized) ? normalized : 'unknown';
}

function normalizeBrowserGeo(browserGeo = {}) {
    return {
        latitude: typeof browserGeo.latitude === 'number' ? browserGeo.latitude : null,
        longitude: typeof browserGeo.longitude === 'number' ? browserGeo.longitude : null,
        accuracy: typeof browserGeo.accuracy === 'number' ? browserGeo.accuracy : null,
        capturedAt: browserGeo.capturedAt instanceof Date
            ? browserGeo.capturedAt
            : (browserGeo.capturedAt ? new Date(browserGeo.capturedAt) : null)
    };
}

function normalizeDeviceMeta(deviceMeta = {}) {
    return {
        platform: deviceMeta.platform || '',
        language: deviceMeta.language || '',
        timezone: deviceMeta.timezone || '',
        screen: deviceMeta.screen || '',
        deviceMemory: typeof deviceMeta.deviceMemory === 'number' ? deviceMeta.deviceMemory : null,
        deviceCores: typeof deviceMeta.deviceCores === 'number' ? deviceMeta.deviceCores : null
    };
}

async function appendLoginHistory(userId, entry = {}) {
    const payload = {
        sessionId: String(entry.sessionId || ''),
        loggedInAt: entry.loggedInAt || new Date(),
        ip: entry.ip || '',
        userAgent: entry.userAgent || '',
        location: normalizeLocation(entry.location),
        geoPermissionState: normalizeGeoPermissionState(entry.geoPermissionState),
        browserGeo: normalizeBrowserGeo(entry.browserGeo),
        deviceMeta: normalizeDeviceMeta(entry.deviceMeta),
        revokedAt: entry.revokedAt || null,
        revokeReason: entry.revokeReason || ''
    };

    await User.findByIdAndUpdate(userId, {
        $push: {
            loginHistory: {
                $each: [payload],
                $position: 0,
                $slice: 10
            }
        }
    });
}

async function markLoginHistoryRevoked(userId, sessionId, reason, revokedAt = new Date()) {
    if (!userId || !sessionId) return;

    await User.updateOne(
        { _id: userId },
        {
            $set: {
                'loginHistory.$[entry].revokedAt': revokedAt,
                'loginHistory.$[entry].revokeReason': reason || ''
            }
        },
        {
            arrayFilters: [{ 'entry.sessionId': String(sessionId) }]
        }
    );
}

function toSessionLocation(tokenDoc, historyEntry) {
    return {
        country: tokenDoc?.locationCountry || historyEntry?.location?.country || '',
        region: tokenDoc?.locationRegion || historyEntry?.location?.region || '',
        city: tokenDoc?.locationCity || historyEntry?.location?.city || '',
        timezone: tokenDoc?.locationTimezone || historyEntry?.location?.timezone || '',
        source: tokenDoc?.locationSource || historyEntry?.location?.source || ''
    };
}

function toSessionGeoPermissionState(tokenDoc, historyEntry) {
    const tokenState = normalizeGeoPermissionState(tokenDoc?.geoPermissionState);
    if (tokenState !== 'unknown') return tokenState;
    return normalizeGeoPermissionState(historyEntry?.geoPermissionState);
}

function toSessionBrowserGeo(tokenDoc, historyEntry) {
    return {
        latitude: typeof tokenDoc?.browserGeoLat === 'number'
            ? tokenDoc.browserGeoLat
            : (typeof historyEntry?.browserGeo?.latitude === 'number' ? historyEntry.browserGeo.latitude : null),
        longitude: typeof tokenDoc?.browserGeoLng === 'number'
            ? tokenDoc.browserGeoLng
            : (typeof historyEntry?.browserGeo?.longitude === 'number' ? historyEntry.browserGeo.longitude : null),
        accuracy: typeof tokenDoc?.browserGeoAccuracy === 'number'
            ? tokenDoc.browserGeoAccuracy
            : (typeof historyEntry?.browserGeo?.accuracy === 'number' ? historyEntry.browserGeo.accuracy : null),
        capturedAt: tokenDoc?.browserGeoCapturedAt || historyEntry?.browserGeo?.capturedAt || null
    };
}

function toSessionDeviceMeta(tokenDoc, historyEntry) {
    return {
        platform: tokenDoc?.devicePlatform || historyEntry?.deviceMeta?.platform || '',
        language: tokenDoc?.deviceLanguage || historyEntry?.deviceMeta?.language || '',
        timezone: tokenDoc?.deviceTimezone || historyEntry?.deviceMeta?.timezone || '',
        screen: tokenDoc?.deviceScreen || historyEntry?.deviceMeta?.screen || '',
        deviceMemory: typeof tokenDoc?.deviceMemory === 'number'
            ? tokenDoc.deviceMemory
            : (typeof historyEntry?.deviceMeta?.deviceMemory === 'number' ? historyEntry.deviceMeta.deviceMemory : null),
        deviceCores: typeof tokenDoc?.deviceCores === 'number'
            ? tokenDoc.deviceCores
            : (typeof historyEntry?.deviceMeta?.deviceCores === 'number' ? historyEntry.deviceMeta.deviceCores : null)
    };
}

function toSessionItemFromToken(tokenDoc, historyEntry, currentTokenHash) {
    const isExpired = !!tokenDoc.expiresAt && tokenDoc.expiresAt < new Date();
    const revokedAt = tokenDoc.revokedAt || historyEntry?.revokedAt || null;
    const revokeReason = tokenDoc.revokeReason || historyEntry?.revokeReason || '';

    return {
        id: String(tokenDoc._id),
        createdAt: tokenDoc.createdAt || historyEntry?.loggedInAt || null,
        lastUsedAt: tokenDoc.lastUsedAt || null,
        isActive: !tokenDoc.revokedAt && !isExpired,
        ip: tokenDoc.createdByIp || historyEntry?.ip || '',
        userAgent: tokenDoc.userAgent || historyEntry?.userAgent || '',
        location: toSessionLocation(tokenDoc, historyEntry),
        geoPermissionState: toSessionGeoPermissionState(tokenDoc, historyEntry),
        browserGeo: toSessionBrowserGeo(tokenDoc, historyEntry),
        deviceMeta: toSessionDeviceMeta(tokenDoc, historyEntry),
        isCurrentSession: !!currentTokenHash && tokenDoc.tokenHash === currentTokenHash,
        revokedAt,
        revokeReason
    };
}

function toSessionItemFromHistoryOnly(historyEntry) {
    return {
        id: String(historyEntry.sessionId || ''),
        createdAt: historyEntry.loggedInAt || null,
        lastUsedAt: null,
        isActive: false,
        ip: historyEntry.ip || '',
        userAgent: historyEntry.userAgent || '',
        location: normalizeLocation(historyEntry.location),
        geoPermissionState: normalizeGeoPermissionState(historyEntry.geoPermissionState),
        browserGeo: normalizeBrowserGeo(historyEntry.browserGeo),
        deviceMeta: normalizeDeviceMeta(historyEntry.deviceMeta),
        isCurrentSession: false,
        revokedAt: historyEntry.revokedAt || null,
        revokeReason: historyEntry.revokeReason || ''
    };
}

async function listUserSessions(userId, currentTokenHash = '') {
    const user = await User.findById(userId).select('loginHistory');
    if (!user) return [];

    const loginHistory = Array.isArray(user.loginHistory) ? user.loginHistory : [];
    const historyBySessionId = new Map();
    const historySessionIds = [];

    loginHistory.forEach((entry) => {
        const sessionId = String(entry.sessionId || '');
        if (!sessionId) return;
        historyBySessionId.set(sessionId, entry);
        historySessionIds.push(sessionId);
    });

    const tokenFilter = { userId };
    if (historySessionIds.length > 0) {
        tokenFilter.$or = [
            { revokedAt: null },
            { _id: { $in: historySessionIds } }
        ];
    } else {
        tokenFilter.revokedAt = null;
    }

    const tokens = await RefreshToken.find(tokenFilter).sort({ createdAt: -1 });

    const tokenSessionIds = new Set();
    const sessions = tokens.map((tokenDoc) => {
        const id = String(tokenDoc._id);
        tokenSessionIds.add(id);
        return toSessionItemFromToken(tokenDoc, historyBySessionId.get(id), currentTokenHash);
    });

    loginHistory.forEach((entry) => {
        const sessionId = String(entry.sessionId || '');
        if (!sessionId || tokenSessionIds.has(sessionId)) return;
        sessions.push(toSessionItemFromHistoryOnly(entry));
    });

    sessions.sort((a, b) => {
        const first = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const second = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return second - first;
    });

    return sessions;
}

module.exports = {
    appendLoginHistory,
    markLoginHistoryRevoked,
    listUserSessions
};
