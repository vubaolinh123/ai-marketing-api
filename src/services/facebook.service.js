const GRAPH_API_BASE = process.env.FB_GRAPH_API_BASE || 'https://graph.facebook.com/v23.0';
const FB_FETCH_TIMEOUT_MS = Number(process.env.FB_FETCH_TIMEOUT_MS || 15000);

function createHttpError(statusCode, message, details = null) {
    const error = new Error(message);
    error.statusCode = statusCode;
    if (details) {
        error.details = details;
    }
    return error;
}

function toIsoOrNull(unixSeconds) {
    const value = Number(unixSeconds);
    if (!Number.isFinite(value) || value <= 0) {
        return null;
    }
    return new Date(value * 1000).toISOString();
}

function mapGraphErrorToHttpError(payload, httpStatus, fallbackMessage) {
    const graphError = payload?.error || {};
    const graphCode = Number(graphError.code);
    const graphSubcode = Number(graphError.error_subcode);
    const rawMessage = String(graphError.message || '').toLowerCase();

    const errorMeta = {
        httpStatus,
        graphCode: Number.isFinite(graphCode) ? graphCode : undefined,
        graphSubcode: Number.isFinite(graphSubcode) ? graphSubcode : undefined,
        graphType: graphError.type,
        fbTraceId: graphError.fbtrace_id
    };

    const isTokenIssue = httpStatus === 401
        || graphCode === 190
        || graphCode === 102
        || rawMessage.includes('access token')
        || rawMessage.includes('invalid oauth')
        || rawMessage.includes('session has expired')
        || rawMessage.includes('token');

    if (isTokenIssue) {
        return createHttpError(400, 'Token Facebook không hợp lệ hoặc đã hết hạn.', errorMeta);
    }

    const isPermissionIssue = httpStatus === 403
        || graphCode === 10
        || graphCode === 200
        || rawMessage.includes('permission')
        || rawMessage.includes('not authorized');

    if (isPermissionIssue) {
        return createHttpError(403, 'Token Facebook không đủ quyền để thực hiện thao tác này.', errorMeta);
    }

    const isPageNotFound = httpStatus === 404 || graphCode === 803;
    if (isPageNotFound) {
        return createHttpError(404, 'Không tìm thấy Trang Facebook. Vui lòng kiểm tra facebookPageId.', errorMeta);
    }

    const isRateLimited = httpStatus === 429 || graphCode === 4 || graphCode === 17 || graphCode === 32;
    if (isRateLimited) {
        return createHttpError(429, 'Facebook đang giới hạn tần suất. Vui lòng thử lại sau.', errorMeta);
    }

    if (httpStatus >= 400 && httpStatus < 500) {
        return createHttpError(400, fallbackMessage || 'Yêu cầu tới Facebook không hợp lệ.', errorMeta);
    }

    return createHttpError(502, 'Không thể kết nối tới Facebook lúc này. Vui lòng thử lại sau.', errorMeta);
}

function buildGraphUrl(path, params = {}) {
    const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
    const url = new URL(`${GRAPH_API_BASE}${normalizedPath}`);

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    });

    return url.toString();
}

async function requestFacebookApi({ method = 'GET', path, query = {}, body = null, fallbackMessage }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FB_FETCH_TIMEOUT_MS);

    try {
        const url = buildGraphUrl(path, query);
        const options = {
            method,
            signal: controller.signal
        };

        if (body && method !== 'GET') {
            options.headers = {
                'Content-Type': 'application/x-www-form-urlencoded'
            };
            options.body = new URLSearchParams(body).toString();
        }

        const response = await fetch(url, options);

        let payload = null;
        try {
            payload = await response.json();
        } catch (_error) {
            payload = null;
        }

        if (!response.ok) {
            throw mapGraphErrorToHttpError(payload, response.status, fallbackMessage);
        }

        return payload || {};
    } catch (error) {
        if (error.name === 'AbortError') {
            throw createHttpError(504, 'Kết nối Facebook quá thời gian chờ. Vui lòng thử lại.');
        }

        if (error.statusCode) {
            throw error;
        }

        throw createHttpError(502, 'Không thể kết nối tới Facebook lúc này. Vui lòng thử lại sau.');
    } finally {
        clearTimeout(timeoutId);
    }
}

function getAppAccessTokenOptional() {
    const explicitAppToken = String(process.env.FB_APP_ACCESS_TOKEN || '').trim();
    if (explicitAppToken) {
        return explicitAppToken;
    }

    const appId = String(process.env.FB_APP_ID || '').trim();
    const appSecret = String(process.env.FB_APP_SECRET || '').trim();

    if (!appId || !appSecret) {
        return '';
    }

    return `${appId}|${appSecret}`;
}

async function tryResolvePageFromToken(token) {
    // Ưu tiên /me/accounts (token user có quyền page sẽ lấy được danh sách page)
    try {
        const accountsResult = await requestFacebookApi({
            method: 'GET',
            path: '/me/accounts',
            query: {
                access_token: token,
                fields: 'id,name'
            },
            fallbackMessage: 'Không thể lấy danh sách Trang từ token Facebook.'
        });

        const firstPage = Array.isArray(accountsResult?.data) ? accountsResult.data[0] : null;
        if (firstPage?.id) {
            return {
                pageId: String(firstPage.id),
                pageName: firstPage?.name ? String(firstPage.name) : null,
                isValid: true
            };
        }
    } catch (_error) {
        // fallback below
    }

    // Fallback: với page access token, /me có thể trả thẳng page profile
    try {
        const meResult = await requestFacebookApi({
            method: 'GET',
            path: '/me',
            query: {
                access_token: token,
                fields: 'id,name'
            },
            fallbackMessage: 'Không thể đọc thông tin chủ thể token Facebook.'
        });

        if (meResult?.id) {
            return {
                pageId: String(meResult.id),
                pageName: meResult?.name ? String(meResult.name) : null,
                isValid: true
            };
        }
    } catch (_error) {
        // invalid or unauthorized token
    }

    return {
        pageId: null,
        pageName: null,
        isValid: false
    };
}

async function verifyPageAccessToken({ token }) {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) {
        throw createHttpError(400, 'Thiếu token Facebook để xác minh.');
    }

    const appAccessToken = getAppAccessTokenOptional();
    let debugData = null;

    if (appAccessToken) {
        try {
            const debugResult = await requestFacebookApi({
                method: 'GET',
                path: '/debug_token',
                query: {
                    input_token: normalizedToken,
                    access_token: appAccessToken
                },
                fallbackMessage: 'Không thể xác minh token Facebook.'
            });
            debugData = debugResult?.data || null;
        } catch (_error) {
            // Không chặn verify nếu server chưa/không thể dùng debug_token
            debugData = null;
        }
    }

    const pageProbe = await tryResolvePageFromToken(normalizedToken);
    const isValidByDebug = debugData ? !!debugData.is_valid : null;
    const isValid = typeof isValidByDebug === 'boolean'
        ? (isValidByDebug && pageProbe.isValid)
        : pageProbe.isValid;

    return {
        isValid,
        expiresAt: toIsoOrNull(debugData?.expires_at),
        dataAccessExpiresAt: toIsoOrNull(debugData?.data_access_expires_at),
        scopes: Array.isArray(debugData?.scopes) ? debugData.scopes : [],
        pageId: pageProbe.pageId,
        pageName: pageProbe.pageName
    };
}

async function publishPagePost({ pageId, pageToken, message }) {
    const normalizedPageId = String(pageId || '').trim();
    const normalizedToken = String(pageToken || '').trim();
    const normalizedMessage = String(message || '').trim();

    if (!normalizedPageId) {
        throw createHttpError(400, 'Thiếu facebookPageId. Vui lòng cấu hình Trang Facebook trước khi đăng bài.');
    }
    if (!normalizedToken) {
        throw createHttpError(400, 'Thiếu token Facebook. Vui lòng cập nhật trong AI Settings.');
    }
    if (!normalizedMessage) {
        throw createHttpError(400, 'Nội dung bài viết Facebook không được để trống.');
    }

    const publishResult = await requestFacebookApi({
        method: 'POST',
        path: `/${encodeURIComponent(normalizedPageId)}/feed`,
        body: {
            message: normalizedMessage,
            access_token: normalizedToken
        },
        fallbackMessage: 'Không thể đăng bài lên Trang Facebook.'
    });

    const postId = publishResult?.id ? String(publishResult.id) : '';
    if (!postId) {
        throw createHttpError(502, 'Facebook không trả về mã bài đăng. Vui lòng thử lại.');
    }

    return {
        postId,
        pageId: normalizedPageId
    };
}

module.exports = {
    verifyPageAccessToken,
    publishPagePost
};
