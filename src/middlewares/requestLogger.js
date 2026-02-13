function isDebugApiEnabled() {
    return String(process.env.DEBUG_API).toLowerCase() === 'true';
}

function requestLogger(req, res, next) {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const shouldLog = isDebugApiEnabled() || res.statusCode >= 400;

        if (!shouldLog) return;

        const payload = {
            type: 'api-request',
            ts: new Date().toISOString(),
            method: req.method,
            path: req.originalUrl || req.url,
            status: res.statusCode,
            durationMs: Number(durationMs.toFixed(2))
        };

        console.log(JSON.stringify(payload));
    });

    next();
}

module.exports = requestLogger;
