const {
    createRequestId,
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
        logApiInboundStart({
            method,
            path: requestPath,
            requestId,
            ip: clientIp
        });

        let hasLoggedFinal = false;

        res.on('finish', () => {
            if (hasLoggedFinal) return;
            hasLoggedFinal = true;

            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            const actor = req.actor || null;
            const effectiveUser = req.user || null;

            logApiInboundEnd({
                method,
                path: requestPath,
                status: res.statusCode,
                durationMs,
                requestId,
                ip: clientIp,
                contentLength: res.getHeader('content-length') || undefined,
                actorId: actor?._id,
                effectiveUserId: effectiveUser?._id,
                isImpersonating: !!req.isImpersonating
            });
        });

        res.on('close', () => {
            if (hasLoggedFinal) return;
            hasLoggedFinal = true;

            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            const statusCode = res.statusCode && res.statusCode > 0 ? res.statusCode : 499;
            const actor = req.actor || null;
            const effectiveUser = req.user || null;

            logApiInboundEnd({
                method,
                path: requestPath,
                status: statusCode,
                durationMs,
                requestId,
                ip: clientIp,
                closedEarly: true,
                actorId: actor?._id,
                effectiveUserId: effectiveUser?._id,
                isImpersonating: !!req.isImpersonating
            });
        });

        next();
    });
}

module.exports = requestLogger;
