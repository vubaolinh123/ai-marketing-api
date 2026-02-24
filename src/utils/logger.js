const { randomUUID } = require('crypto');
const { getRequestContext } = require('./logContext');

const ANSI_COLORS = {
    reset: '\x1b[0m',
    gray: '\x1b[90m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m'
};

const EVENT_STYLES = {
    STARTUP: { icon: '🚀', color: ANSI_COLORS.magenta, label: 'STARTUP' },
    API_IN_START: { icon: '📥', color: ANSI_COLORS.cyan, label: 'API_IN_START' },
    API_IN_END: { icon: '📬', color: ANSI_COLORS.green, label: 'API_IN_END' },
    OUT_REQ: { icon: '🌐', color: ANSI_COLORS.blue, label: 'OUT_REQ' },
    OUT_RES: { icon: '🛰️', color: ANSI_COLORS.magenta, label: 'OUT_RES' },
    WARN: { icon: '⚠️', color: ANSI_COLORS.yellow, label: 'WARN' },
    ERROR: { icon: '❌', color: ANSI_COLORS.red, label: 'ERROR' }
};

const MAX_LOG_VALUE_LENGTH = 240;

function isDetailedApiLogEnabled() {
    return String(process.env.DEBUG_API).toLowerCase() === 'true';
}

function colorize(text, color) {
    return `${color}${text}${ANSI_COLORS.reset}`;
}

function getVietnamTimestamp(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const parts = formatter.formatToParts(date).reduce((acc, part) => {
        if (part.type !== 'literal') {
            acc[part.type] = part.value;
        }
        return acc;
    }, {});

    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${ms} +07`;
}

function createRequestId() {
    return randomUUID().replace(/-/g, '').slice(0, 12);
}

function sanitizeLogValue(value) {
    if (value === undefined || value === null) return '';

    let text;
    if (typeof value === 'string') {
        text = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
        text = String(value);
    } else {
        try {
            text = JSON.stringify(value);
        } catch (_error) {
            text = String(value);
        }
    }

    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= MAX_LOG_VALUE_LENGTH) return normalized;
    return `${normalized.slice(0, MAX_LOG_VALUE_LENGTH)}...[truncated:${normalized.length - MAX_LOG_VALUE_LENGTH}]`;
}

function ensureRequestId(requestId) {
    if (typeof requestId === 'string' && requestId.trim()) {
        return requestId.trim();
    }

    const context = getRequestContext();
    if (typeof context.requestId === 'string' && context.requestId.trim()) {
        return context.requestId.trim();
    }

    return null;
}

function formatDuration(durationMs) {
    if (durationMs === undefined || durationMs === null || Number.isNaN(Number(durationMs))) {
        return '-';
    }

    const value = Number(durationMs);
    if (value >= 100) {
        return `${Math.round(value)}ms`;
    }

    return `${value.toFixed(2)}ms`;
}

function getStatusColor(status) {
    const code = Number(status);
    if (!Number.isFinite(code)) return ANSI_COLORS.gray;
    if (code >= 500) return ANSI_COLORS.red;
    if (code >= 400) return ANSI_COLORS.yellow;
    if (code >= 300) return ANSI_COLORS.cyan;
    return ANSI_COLORS.green;
}

function formatStatus(status) {
    if (status === undefined || status === null || status === '') {
        return '-';
    }

    return colorize(String(status), getStatusColor(status));
}

function formatMeta(meta = {}) {
    return Object.entries(meta)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}=${sanitizeLogValue(value)}`)
        .join(' ');
}

function buildTargetLine(method, target) {
    return `${sanitizeLogValue(method || '-')} ${sanitizeLogValue(target || '-')}`;
}

function emit(event, message, meta = {}) {
    const eventStyle = EVENT_STYLES[event] || EVENT_STYLES.WARN;
    const context = getRequestContext();

    const mergedMeta = { ...meta };
    const requestId = ensureRequestId(mergedMeta.requestId);
    delete mergedMeta.requestId;

    if (!mergedMeta.source && context.inboundMethod && context.inboundPath && event.startsWith('OUT_')) {
        mergedMeta.source = `${context.inboundMethod} ${context.inboundPath}`;
    }

    if (requestId) {
        mergedMeta.rid = requestId;
    }

    const ts = colorize(getVietnamTimestamp(), ANSI_COLORS.gray);
    const eventLabel = colorize(`${eventStyle.icon} ${eventStyle.label}`, eventStyle.color);
    const metaText = formatMeta(mergedMeta);

    const line = [
        ts,
        eventLabel,
        sanitizeLogValue(message),
        metaText
    ].filter(Boolean).join(' ');

    console.log(line);
}

function logStartup(message, meta = {}) {
    emit('STARTUP', message, meta);
}

function logWarn(message, meta = {}) {
    emit('WARN', message, meta);
}

function logError(message, meta = {}) {
    const normalizedMeta = { ...meta };

    if (normalizedMeta.error instanceof Error) {
        const err = normalizedMeta.error;
        delete normalizedMeta.error;
        normalizedMeta.errorMessage = err.message;

        if (process.env.NODE_ENV === 'development') {
            normalizedMeta.stack = err.stack;
        }
    }

    emit('ERROR', message, normalizedMeta);
}

function logApiInboundStart({ method, path, ...meta } = {}) {
    emit('API_IN_START', buildTargetLine(method, path), meta);
}

function logApiInboundEnd({ method, path, status, durationMs, ...meta } = {}) {
    const statusText = formatStatus(status);
    const durationText = colorize(formatDuration(durationMs), ANSI_COLORS.gray);
    emit('API_IN_END', `${buildTargetLine(method, path)} ${statusText} ${durationText}`, meta);
}

function normalizeDisplayInfo(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim();
}

function buildDisplayTextRules(displayInfo) {
    const normalized = normalizeDisplayInfo(displayInfo);

    if (!normalized) {
        return {
            normalized,
            block: [
                '### DISPLAY TEXT POLICY (HIGHEST PRIORITY)',
                '- Do NOT render any readable text, typography, headline, caption, slogan, or brand wording on image.',
                '- Keep surfaces/signage/labels without text artifacts.',
                '- This policy overrides all other creative or brand-context hints about typography.'
            ].join('\n')
        };
    }

    return {
        normalized,
        block: [
            '### DISPLAY TEXT POLICY (HIGHEST PRIORITY)',
            `- REQUIRED exact display text: "${normalized}"`,
            '- Render ONLY this exact text string. Do NOT change wording, do NOT translate, do NOT abbreviate, do NOT add/remove words.',
            '- Do NOT render any other readable text (including brand names, slogans, watermarks, labels, decorative typography).',
            '- This policy overrides brand context and any other typography hints.'
        ].join('\n')
    };
}

function logOutboundRequest({ method = 'POST', url, ...meta } = {}) {
    emit('OUT_REQ', buildTargetLine(method, url), meta);
}

function logOutboundResponse({ method = 'POST', url, status, durationMs, error, ...meta } = {}) {
    const statusText = formatStatus(status);
    const durationText = colorize(formatDuration(durationMs), ANSI_COLORS.gray);

    if (error) {
        emit('ERROR', `${buildTargetLine(method, url)} ${statusText} ${durationText}`, {
            ...meta,
            error: sanitizeLogValue(error)
        });
        return;
    }

    emit('OUT_RES', `${buildTargetLine(method, url)} ${statusText} ${durationText}`, meta);
}

module.exports = {
    ANSI_COLORS,
    isDetailedApiLogEnabled,
    getVietnamTimestamp,
    createRequestId,
    logStartup,
    logWarn,
    logError,
    logApiInboundStart,
    logApiInboundEnd,
    logOutboundRequest,
    logOutboundResponse,
    normalizeDisplayInfo,
    buildDisplayTextRules
};
