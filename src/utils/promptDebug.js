const MAX_STRING_LENGTH = 1200;
const SENSITIVE_KEY_PATTERN = /(token|password|api[_-]?key|secret|authorization)/i;

function isPromptDebugEnabled() {
    return String(process.env.DEBUG_PROMT).toLowerCase() === 'true';
}

function truncateString(value) {
    const text = String(value);
    if (text.length <= MAX_STRING_LENGTH) return text;
    return `${text.slice(0, MAX_STRING_LENGTH)}...[truncated:${text.length - MAX_STRING_LENGTH}]`;
}

function sanitizeValue(value, key = '', seen = new WeakSet()) {
    if (SENSITIVE_KEY_PATTERN.test(String(key))) {
        return '[REDACTED]';
    }

    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === 'string') {
        return truncateString(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item, key, seen));
    }

    if (typeof value === 'object') {
        if (seen.has(value)) {
            return '[Circular]';
        }
        seen.add(value);

        const output = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            output[childKey] = sanitizeValue(childValue, childKey, seen);
        }
        return output;
    }

    return truncateString(value);
}

function logPromptDebug({ tool = 'unknown', step = 'unknown', data = {} } = {}) {
    if (!isPromptDebugEnabled()) return;

    const payload = {
        type: 'prompt-debug',
        ts: new Date().toISOString(),
        tool,
        step,
        data: sanitizeValue(data)
    };

    console.log(JSON.stringify(payload));
}

module.exports = {
    isPromptDebugEnabled,
    logPromptDebug
};
