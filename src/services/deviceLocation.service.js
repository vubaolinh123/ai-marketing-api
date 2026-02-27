function parseClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];

    if (Array.isArray(forwarded) && forwarded.length > 0) {
        return String(forwarded[0] || '').split(',')[0].trim();
    }

    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }

    return req.ip || req.socket?.remoteAddress || '';
}

function normalizeIp(ip) {
    if (!ip) return '';

    let normalized = String(ip).trim();

    if (normalized.includes(',')) {
        normalized = normalized.split(',')[0].trim();
    }

    if (normalized.startsWith('::ffff:')) {
        normalized = normalized.slice(7);
    }

    if (normalized === '::1') {
        return '127.0.0.1';
    }

    return normalized;
}

function isPrivateOrLocalIp(ip) {
    if (!ip) return true;

    const value = String(ip).toLowerCase();

    if (value === '127.0.0.1' || value === 'localhost' || value === '::1') {
        return true;
    }

    if (value.startsWith('10.') || value.startsWith('192.168.')) {
        return true;
    }

    if (value.startsWith('172.')) {
        const secondOctet = Number(value.split('.')[1]);
        if (!Number.isNaN(secondOctet) && secondOctet >= 16 && secondOctet <= 31) {
            return true;
        }
    }

    if (value.startsWith('169.254.')) {
        return true;
    }

    if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) {
        return true;
    }

    return false;
}

function resolveLocationByIp(ip) {
    if (isPrivateOrLocalIp(ip)) {
        return {
            country: 'Local',
            region: '',
            city: '',
            timezone: '',
            source: 'private-ip'
        };
    }

    return {
        country: 'Unknown',
        region: '',
        city: '',
        timezone: '',
        source: 'ip-unresolved'
    };
}

module.exports = {
    parseClientIp,
    normalizeIp,
    resolveLocationByIp
};
