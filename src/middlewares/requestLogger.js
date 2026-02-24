const {
    createRequestId,
    isDetailedApiLogEnabled,
    logApiInboundStart,
    logApiInboundEnd,
    runWithRequestContext
} = require('../utils');

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }

    return req.ip || req.socket?.remoteAddress || 'unknown';
}

function requestLogger(req, res, next) {
    const requestId = req.headers['x-request-id'] || createRequestId();
    const startedAt = process.hrtime.bigint();
    const method = req.method;
    const requestPath = req.originalUrl || req.url;
    const clientIp = getClientIp(req);

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    runWithRequestContext({
        requestId,
        inboundMethod: method,
        inboundPath: requestPath
    }, () => {
        if (isDetailedApiLogEnabled()) {
            logApiInboundStart({
                method,
                path: requestPath,
                requestId,
                ip: clientIp
            });
        }

        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            const shouldLog = isDetailedApiLogEnabled() || res.statusCode >= 400;

            if (!shouldLog) return;

            logApiInboundEnd({
                method,
                path: requestPath,
                status: res.statusCode,
                durationMs,
                requestId,
                ip: clientIp,
                contentLength: res.getHeader('content-length') || undefined
            });
        });

        next();
    });
}

module.exports = requestLogger;
