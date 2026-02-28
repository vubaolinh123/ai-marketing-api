const mongoose = require('mongoose');
const { TokenUsageDaily, TokenUsageFeatureDaily } = require('../models');
const { getRequestContext } = require('../utils/logContext');
const { logWarn, logError } = require('../utils/logger');

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_PROVIDER = 'google-gemini';
const TOOL_ENUM = ['article', 'image', 'video', 'marketing', 'unknown'];
const TOKEN_BUCKET_FIELDS = [
    'supplementalTokens',
    'thoughtTokens',
    'cachedTokens',
    'toolUseTokens',
    'otherKnownTokens',
    'explainedSupplementalTokens',
    'unexplainedTokens'
];
const ZERO_TOKEN_USAGE = {
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    supplementalTokens: 0,
    thoughtTokens: 0,
    cachedTokens: 0,
    toolUseTokens: 0,
    otherKnownTokens: 0,
    explainedSupplementalTokens: 0,
    unexplainedTokens: 0
};
const ZERO_GEMINI_USAGE = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    supplementalTokens: 0,
    thoughtTokens: 0,
    cachedTokens: 0,
    toolUseTokens: 0,
    otherKnownTokens: 0,
    explainedSupplementalTokens: 0,
    unexplainedTokens: 0
};
const ZERO_DISCREPANCY = {
    baseTokens: 0,
    supplementalTokens: 0,
    thoughtTokens: 0,
    cachedTokens: 0,
    toolUseTokens: 0,
    otherKnownTokens: 0,
    explainedSupplementalTokens: 0,
    unexplainedTokens: 0
};

function isTokenUsageDebugEnabled() {
    return String(process.env.TOKEN_USAGE_DEBUG || '').trim().toLowerCase() === 'true';
}

function logTokenUsageDebug(message, meta = {}) {
    if (!isTokenUsageDebugEnabled()) {
        return;
    }

    logWarn(`[TOKEN_USAGE_DEBUG] ${message}`, meta);
}

function toPositiveNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
    }
    return numeric;
}

function sumTokenDetails(details) {
    if (!Array.isArray(details)) {
        return 0;
    }

    return details.reduce((total, item) => {
        if (typeof item === 'number' || typeof item === 'string') {
            return total + toPositiveNumber(item);
        }

        if (!item || typeof item !== 'object') {
            return total;
        }

        return total + toPositiveNumber(item.tokenCount ?? item.tokens ?? item.count);
    }, 0);
}

function readUsageCount(usageMetadata, directKeys = [], detailKeys = []) {
    for (const key of directKeys) {
        const directValue = toPositiveNumber(usageMetadata?.[key]);
        if (directValue > 0) {
            return directValue;
        }
    }

    let detailTotal = 0;
    for (const key of detailKeys) {
        detailTotal += sumTokenDetails(usageMetadata?.[key]);
    }

    return detailTotal;
}

function toObjectIdOrNull(value) {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;

    const stringValue = String(value).trim();
    if (!mongoose.Types.ObjectId.isValid(stringValue)) {
        return null;
    }

    return new mongoose.Types.ObjectId(stringValue);
}

function getTimeZoneDateParts(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: VIETNAM_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const parts = formatter.formatToParts(date).reduce((acc, part) => {
        if (part.type !== 'literal') {
            acc[part.type] = part.value;
        }
        return acc;
    }, {});

    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day)
    };
}

function formatDateKey(date = new Date()) {
    const { year, month, day } = getTimeZoneDateParts(date);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatMonthKey(date = new Date()) {
    const { year, month } = getTimeZoneDateParts(date);
    return `${year}-${String(month).padStart(2, '0')}`;
}

function formatWeekKey(date = new Date()) {
    const { year, month, day } = getTimeZoneDateParts(date);
    const utcDate = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = utcDate.getUTCDay() || 7;

    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayOfWeek);

    const isoYear = utcDate.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const weekNumber = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);

    return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
}

function buildDateKeys(date = new Date()) {
    return {
        dateKey: formatDateKey(date),
        monthKey: formatMonthKey(date),
        weekKey: formatWeekKey(date)
    };
}

function normalizeInboundPath(path = '') {
    const rawPath = String(path || '').trim();
    if (!rawPath) {
        return '';
    }

    let cleanPath = rawPath.split('?')[0].split('#')[0].trim();

    if (/^https?:\/\//i.test(cleanPath)) {
        try {
            cleanPath = new URL(cleanPath).pathname || '';
        } catch (_error) {
            // keep original cleanPath fallback
        }
    }

    if (!cleanPath.startsWith('/')) {
        const apiPathIndex = cleanPath.indexOf('/api/');
        if (apiPathIndex >= 0) {
            cleanPath = cleanPath.slice(apiPathIndex);
        }
    }

    if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
        return cleanPath.slice(0, -1);
    }

    return cleanPath;
}

function pathMatches(normalizedPath = '', routePath = '') {
    if (!normalizedPath || !routePath) {
        return false;
    }

    return normalizedPath === routePath
        || normalizedPath.startsWith(`${routePath}/`);
}

function inferToolFromPath(path = '') {
    const normalizedPath = normalizeInboundPath(path);

    if (!normalizedPath) {
        return 'unknown';
    }

    if (pathMatches(normalizedPath, '/api/ai/analyze-image')) {
        return 'image';
    }
    if (
        pathMatches(normalizedPath, '/api/ai/generate-article') ||
        pathMatches(normalizedPath, '/api/ai/generate-and-save')
    ) {
        return 'article';
    }

    // Fallback route-path checks for known high-volume endpoints
    if (pathMatches(normalizedPath, '/api/product-images/generate')) {
        return 'image';
    }

    if (normalizedPath.startsWith('/api/ai') || normalizedPath.startsWith('/api/articles')) {
        return 'article';
    }
    if (normalizedPath.startsWith('/api/product-images')) {
        return 'image';
    }
    if (normalizedPath.startsWith('/api/video-scripts')) {
        return 'video';
    }
    if (normalizedPath.startsWith('/api/marketing-plan')) {
        return 'marketing';
    }

    return 'unknown';
}

function inferFeatureFromPath(path = '') {
    const normalizedPath = normalizeInboundPath(path);

    if (pathMatches(normalizedPath, '/api/ai/generate-article')) {
        return 'article.generate-preview';
    }
    if (pathMatches(normalizedPath, '/api/ai/generate-and-save')) {
        return 'article.generate-save';
    }
    if (pathMatches(normalizedPath, '/api/ai/analyze-image')) {
        return 'image.analyze';
    }
    if (pathMatches(normalizedPath, '/api/product-images/generate')) {
        return 'image.generate';
    }
    if (pathMatches(normalizedPath, '/api/product-images')) {
        return 'image.manage';
    }
    if (/^\/api\/product-images\/[^/]+\/regenerate$/.test(normalizedPath)) {
        return 'image.regenerate';
    }
    if (normalizedPath.startsWith('/api/video-scripts/generate-idea')) {
        return 'video.generate-idea';
    }
    if (normalizedPath.startsWith('/api/video-scripts/suggest-concepts')) {
        return 'video.suggest-concepts';
    }
    if (normalizedPath.startsWith('/api/video-scripts/generate')) {
        return 'video.generate-script';
    }
    if (normalizedPath.startsWith('/api/video-scripts')) {
        return 'video.manage';
    }
    if (normalizedPath.startsWith('/api/marketing-plan/suggest-strategy')) {
        return 'marketing.suggest-strategy';
    }
    if (normalizedPath.startsWith('/api/marketing-plan/generate')) {
        return 'marketing.generate-plan';
    }
    if (normalizedPath.startsWith('/api/marketing-plan')) {
        return 'marketing.manage';
    }
    if (normalizedPath.startsWith('/api/ai')) {
        return 'article.general';
    }

    return 'unknown';
}

function extractGeminiUsageMetadata(responsePayload) {
    const usageMetadata = responsePayload?.response?.usageMetadata || responsePayload?.usageMetadata || null;
    if (!usageMetadata || typeof usageMetadata !== 'object') {
        return { ...ZERO_GEMINI_USAGE };
    }

    const promptTokens = readUsageCount(
        usageMetadata,
        ['promptTokenCount'],
        ['promptTokensDetails', 'promptTokenDetails']
    );
    const completionTokens = readUsageCount(
        usageMetadata,
        ['candidatesTokenCount'],
        ['candidatesTokensDetails', 'candidateTokensDetails']
    );
    let totalTokens = readUsageCount(
        usageMetadata,
        ['totalTokenCount'],
        ['totalTokensDetails']
    );

    if (!totalTokens && (promptTokens || completionTokens)) {
        totalTokens = promptTokens + completionTokens;
    }

    const thoughtTokens = readUsageCount(
        usageMetadata,
        ['thoughtsTokenCount', 'thoughtTokenCount'],
        ['thoughtsTokensDetails', 'thoughtTokensDetails']
    );
    const cachedTokens = readUsageCount(
        usageMetadata,
        ['cachedContentTokenCount', 'cacheTokenCount'],
        ['cachedContentTokensDetails', 'cachedTokensDetails']
    );
    const toolUseTokens = readUsageCount(
        usageMetadata,
        ['toolUsePromptTokenCount', 'toolUseTokenCount'],
        ['toolUsePromptTokensDetails', 'toolUseTokensDetails']
    );

    const knownTokenCountKeys = new Set([
        'promptTokenCount',
        'candidatesTokenCount',
        'totalTokenCount',
        'thoughtsTokenCount',
        'thoughtTokenCount',
        'cachedContentTokenCount',
        'cacheTokenCount',
        'toolUsePromptTokenCount',
        'toolUseTokenCount'
    ]);

    let otherKnownTokens = 0;
    Object.entries(usageMetadata).forEach(([key, value]) => {
        if (!key.endsWith('TokenCount') && !key.endsWith('Tokens')) {
            return;
        }
        if (knownTokenCountKeys.has(key)) {
            return;
        }
        otherKnownTokens += toPositiveNumber(value);
    });

    if (!totalTokens) {
        totalTokens = promptTokens + completionTokens + thoughtTokens + cachedTokens + toolUseTokens + otherKnownTokens;
    }

    const supplementalTokens = Math.max(totalTokens - (promptTokens + completionTokens), 0);
    const explainedSupplementalTokens = Math.min(
        supplementalTokens,
        thoughtTokens + cachedTokens + toolUseTokens + otherKnownTokens
    );
    const unexplainedTokens = Math.max(supplementalTokens - explainedSupplementalTokens, 0);

    return {
        promptTokens,
        completionTokens,
        totalTokens,
        supplementalTokens,
        thoughtTokens,
        cachedTokens,
        toolUseTokens,
        otherKnownTokens,
        explainedSupplementalTokens,
        unexplainedTokens
    };
}

async function recordGeminiTokenUsage({ modelName, operation, responsePayload, fallbackPromptTokens = 0, fallbackSource = '' } = {}) {
    try {
        const context = getRequestContext();
        const requestId = context.requestId || '';
        const inboundPath = context.inboundPath || '';
        const normalizedInboundPath = normalizeInboundPath(inboundPath);
        const debugEnabled = isTokenUsageDebugEnabled();
        const fallbackPrompt = toPositiveNumber(fallbackPromptTokens);

        let usage = extractGeminiUsageMetadata(responsePayload);
        let fallbackApplied = false;

        if (
            usage.totalTokens <= 0
            && usage.promptTokens <= 0
            && usage.completionTokens <= 0
            && fallbackPrompt > 0
        ) {
            usage = {
                ...usage,
                promptTokens: fallbackPrompt,
                completionTokens: 0,
                totalTokens: fallbackPrompt,
                supplementalTokens: 0,
                thoughtTokens: 0,
                cachedTokens: 0,
                toolUseTokens: 0,
                otherKnownTokens: 0,
                explainedSupplementalTokens: 0,
                unexplainedTokens: 0
            };
            fallbackApplied = true;
        }

        if (debugEnabled) {
            logTokenUsageDebug('Parsed Gemini usage payload', {
                requestId,
                inboundPath: normalizedInboundPath || inboundPath,
                modelName: modelName || '',
                operation: operation || '',
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
                supplementalTokens: usage.supplementalTokens,
                thoughtTokens: usage.thoughtTokens,
                cachedTokens: usage.cachedTokens,
                toolUseTokens: usage.toolUseTokens,
                otherKnownTokens: usage.otherKnownTokens,
                explainedSupplementalTokens: usage.explainedSupplementalTokens,
                unexplainedTokens: usage.unexplainedTokens,
                fallbackPromptTokens: fallbackPrompt,
                fallbackApplied,
                fallbackSource: fallbackSource || ''
            });
        }

        const effectiveUserId = toObjectIdOrNull(context.effectiveUserId);
        if (!effectiveUserId) {
            logWarn('Bỏ qua ghi token usage do thiếu effectiveUserId trong request context', {
                modelName,
                operation,
                inboundPath: normalizedInboundPath || inboundPath,
                requestId
            });
            return;
        }

        if (usage.totalTokens <= 0 && usage.promptTokens <= 0 && usage.completionTokens <= 0) {
            logWarn('Bỏ qua ghi token usage do usageMetadata không có token', {
                modelName,
                operation,
                fallbackPromptTokens: fallbackPrompt,
                fallbackSource: fallbackSource || '',
                inboundPath: normalizedInboundPath || inboundPath,
                requestId
            });
            return;
        }

        const now = new Date();
        const { dateKey, monthKey, weekKey } = buildDateKeys(now);
        const tool = inferToolFromPath(inboundPath);
        const featureKey = inferFeatureFromPath(inboundPath);
        const actorUserId = toObjectIdOrNull(context.actorUserId);

        if (debugEnabled) {
            logTokenUsageDebug('Resolved token usage mapping', {
                requestId,
                inboundPath: normalizedInboundPath || inboundPath,
                modelName: modelName || '',
                operation: operation || '',
                effectiveUserId: String(effectiveUserId),
                actorUserId: actorUserId ? String(actorUserId) : '',
                tool,
                featureKey
            });
        }

        const usageIncrement = {
            requestCount: 1,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            supplementalTokens: usage.supplementalTokens,
            thoughtTokens: usage.thoughtTokens,
            cachedTokens: usage.cachedTokens,
            toolUseTokens: usage.toolUseTokens,
            otherKnownTokens: usage.otherKnownTokens,
            explainedSupplementalTokens: usage.explainedSupplementalTokens,
            unexplainedTokens: usage.unexplainedTokens
        };

        const commonSet = {
            weekKey,
            monthKey,
            actorUserId,
            isImpersonating: !!context.isImpersonating,
            model: modelName || '',
            lastRequestAt: now
        };

        const [dailyResult, featureResult] = await Promise.all([
            TokenUsageDaily.updateOne(
                {
                    dateKey,
                    userId: effectiveUserId,
                    tool,
                    provider: DEFAULT_PROVIDER
                },
                {
                    $set: commonSet,
                    $setOnInsert: {
                        dateKey,
                        userId: effectiveUserId,
                        tool,
                        provider: DEFAULT_PROVIDER,
                        firstRequestAt: now
                    },
                    $inc: usageIncrement
                },
                {
                    upsert: true
                }
            ),
            TokenUsageFeatureDaily.updateOne(
                {
                    dateKey,
                    userId: effectiveUserId,
                    featureKey,
                    provider: DEFAULT_PROVIDER
                },
                {
                    $set: {
                        ...commonSet,
                        tool,
                        featureKey
                    },
                    $setOnInsert: {
                        dateKey,
                        userId: effectiveUserId,
                        provider: DEFAULT_PROVIDER,
                        firstRequestAt: now
                    },
                    $inc: usageIncrement
                },
                {
                    upsert: true
                }
            )
        ]);

        if (debugEnabled) {
            logTokenUsageDebug('Token usage upsert results', {
                requestId,
                inboundPath: normalizedInboundPath || inboundPath,
                modelName: modelName || '',
                operation: operation || '',
                dailyMatched: dailyResult?.matchedCount ?? 0,
                dailyModified: dailyResult?.modifiedCount ?? 0,
                dailyUpserted: dailyResult?.upsertedCount ?? 0,
                dailyUpsertedId: dailyResult?.upsertedId ? String(dailyResult.upsertedId) : '',
                featureMatched: featureResult?.matchedCount ?? 0,
                featureModified: featureResult?.modifiedCount ?? 0,
                featureUpserted: featureResult?.upsertedCount ?? 0,
                featureUpsertedId: featureResult?.upsertedId ? String(featureResult.upsertedId) : ''
            });
        }
    } catch (error) {
        logWarn('Không thể ghi nhận token usage Gemini', {
            modelName,
            operation,
            message: error?.message
        });
        logError('Gemini token usage logging error', { error });
    }
}

function isDateKey(value = '') {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function parseInputToDateKey(value) {
    if (!value) return '';

    const raw = String(value).trim();
    if (!raw) return '';
    if (isDateKey(raw)) return raw;

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';

    return formatDateKey(parsed);
}

function addDaysToDateKey(dateKey, days) {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    const utcDate = new Date(Date.UTC(year, month - 1, day));
    utcDate.setUTCDate(utcDate.getUTCDate() + Number(days || 0));
    return formatDateKey(utcDate);
}

function parseRangeQuery({ from, to } = {}) {
    const todayKey = formatDateKey(new Date());
    let fromKey = parseInputToDateKey(from);
    let toKey = parseInputToDateKey(to);

    if (!fromKey && !toKey) {
        toKey = todayKey;
        fromKey = addDaysToDateKey(toKey, -29);
    } else if (!fromKey && toKey) {
        fromKey = addDaysToDateKey(toKey, -29);
    } else if (fromKey && !toKey) {
        toKey = todayKey;
    }

    if (fromKey > toKey) {
        const temp = fromKey;
        fromKey = toKey;
        toKey = temp;
    }

    return {
        fromKey,
        toKey
    };
}

function normalizeGroupBy(groupBy = 'day') {
    const normalized = String(groupBy || 'day').trim().toLowerCase();
    if (['day', 'week', 'month'].includes(normalized)) {
        return normalized;
    }
    return 'day';
}

function normalizeLimit(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
}

function parseDateKeyToUtcDate(dateKey = '') {
    if (!isDateKey(dateKey)) {
        return null;
    }

    const [year, month, day] = String(dateKey).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

function getBucketKeyFromDateKey(dateKey = '', groupBy = 'day') {
    if (!dateKey) {
        return '';
    }

    const normalizedGroupBy = normalizeGroupBy(groupBy);
    if (normalizedGroupBy === 'day') {
        return dateKey;
    }

    const utcDate = parseDateKeyToUtcDate(dateKey);
    if (!utcDate) {
        return dateKey;
    }

    if (normalizedGroupBy === 'week') {
        return formatWeekKey(utcDate);
    }

    if (normalizedGroupBy === 'month') {
        return formatMonthKey(utcDate);
    }

    return dateKey;
}

function buildBucketSeries({ fromKey, toKey, groupBy = 'day' } = {}) {
    if (!fromKey || !toKey) {
        return [];
    }

    const buckets = [];
    const seen = new Set();
    let cursor = fromKey;
    let guard = 0;

    while (cursor <= toKey && guard < 10000) {
        const bucket = getBucketKeyFromDateKey(cursor, groupBy);
        if (bucket && !seen.has(bucket)) {
            seen.add(bucket);
            buckets.push(bucket);
        }
        cursor = addDaysToDateKey(cursor, 1);
        guard += 1;
    }

    return buckets;
}

function buildTokenGroupAccumulators() {
    return {
        requestCount: { $sum: { $ifNull: ['$requestCount', 0] } },
        promptTokens: { $sum: { $ifNull: ['$promptTokens', 0] } },
        completionTokens: { $sum: { $ifNull: ['$completionTokens', 0] } },
        totalTokens: { $sum: { $ifNull: ['$totalTokens', 0] } },
        supplementalTokens: { $sum: { $ifNull: ['$supplementalTokens', 0] } },
        thoughtTokens: { $sum: { $ifNull: ['$thoughtTokens', 0] } },
        cachedTokens: { $sum: { $ifNull: ['$cachedTokens', 0] } },
        toolUseTokens: { $sum: { $ifNull: ['$toolUseTokens', 0] } },
        otherKnownTokens: { $sum: { $ifNull: ['$otherKnownTokens', 0] } },
        explainedSupplementalTokens: { $sum: { $ifNull: ['$explainedSupplementalTokens', 0] } },
        unexplainedTokens: { $sum: { $ifNull: ['$unexplainedTokens', 0] } }
    };
}

function normalizeTokenUsage(payload = {}) {
    return {
        requestCount: Number(payload.requestCount) || 0,
        promptTokens: Number(payload.promptTokens) || 0,
        completionTokens: Number(payload.completionTokens) || 0,
        totalTokens: Number(payload.totalTokens) || 0,
        supplementalTokens: Number(payload.supplementalTokens) || 0,
        thoughtTokens: Number(payload.thoughtTokens) || 0,
        cachedTokens: Number(payload.cachedTokens) || 0,
        toolUseTokens: Number(payload.toolUseTokens) || 0,
        otherKnownTokens: Number(payload.otherKnownTokens) || 0,
        explainedSupplementalTokens: Number(payload.explainedSupplementalTokens) || 0,
        unexplainedTokens: Number(payload.unexplainedTokens) || 0
    };
}

function buildDiscrepancy(payload = {}) {
    const usage = normalizeTokenUsage(payload);
    return {
        baseTokens: usage.promptTokens + usage.completionTokens,
        supplementalTokens: usage.supplementalTokens,
        thoughtTokens: usage.thoughtTokens,
        cachedTokens: usage.cachedTokens,
        toolUseTokens: usage.toolUseTokens,
        otherKnownTokens: usage.otherKnownTokens,
        explainedSupplementalTokens: usage.explainedSupplementalTokens,
        unexplainedTokens: usage.unexplainedTokens
    };
}

async function getTokenUsageSummary({ from, to, groupBy = 'day', userId = null, limitUsers = 20 } = {}) {
    const range = parseRangeQuery({ from, to });
    const normalizedGroupBy = normalizeGroupBy(groupBy);
    const normalizedLimitUsers = normalizeLimit(limitUsers, 20, 1, 100);
    const userObjectId = toObjectIdOrNull(userId);
    const bucketSeries = buildBucketSeries({
        fromKey: range.fromKey,
        toKey: range.toKey,
        groupBy: normalizedGroupBy
    });
    const zeroUsage = normalizeTokenUsage(ZERO_TOKEN_USAGE);
    const chartMeta = {
        groupBy: normalizedGroupBy,
        bucketCount: bucketSeries.length,
        from: range.fromKey,
        to: range.toKey
    };

    const match = {
        dateKey: {
            $gte: range.fromKey,
            $lte: range.toKey
        }
    };

    if (userId && !userObjectId) {
        return {
            totals: {
                ...ZERO_TOKEN_USAGE,
                activeUsers: 0
            },
            timeline: bucketSeries.map((bucket) => ({
                bucket,
                ...zeroUsage
            })),
            timelineByTool: bucketSeries.flatMap((bucket) => TOOL_ENUM.map((tool) => ({
                bucket,
                tool,
                ...zeroUsage
            }))),
            topTools: TOOL_ENUM.map((tool) => ({
                tool,
                ...ZERO_TOKEN_USAGE
            })),
            topUsers: [],
            topFeatures: [],
            discrepancy: { ...ZERO_DISCREPANCY },
            chartMeta,
            range: {
                from: range.fromKey,
                to: range.toKey,
                groupBy: normalizedGroupBy,
                userId: null
            }
        };
    }

    if (userObjectId) {
        match.userId = userObjectId;
    }

    const timelineBucketField = normalizedGroupBy === 'week'
        ? { $ifNull: ['$weekKey', '$dateKey'] }
        : normalizedGroupBy === 'month'
            ? { $ifNull: ['$monthKey', { $substrBytes: ['$dateKey', 0, 7] }] }
            : '$dateKey';

    const [totalsRaw, timelineRaw, timelineByToolRaw, topToolsRaw, topUsersRaw, topFeaturesRaw, activeUsersRaw] = await Promise.all([
        TokenUsageDaily.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    ...buildTokenGroupAccumulators()
                }
            }
        ]),
        TokenUsageDaily.aggregate([
            { $match: match },
            {
                $group: {
                    _id: timelineBucketField,
                    ...buildTokenGroupAccumulators()
                }
            },
            { $sort: { _id: 1 } }
        ]),
        TokenUsageDaily.aggregate([
            { $match: match },
            {
                $group: {
                    _id: {
                        bucket: timelineBucketField,
                        tool: { $ifNull: ['$tool', 'unknown'] }
                    },
                    ...buildTokenGroupAccumulators()
                }
            },
            { $sort: { '_id.bucket': 1, '_id.tool': 1 } }
        ]),
        TokenUsageDaily.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$tool',
                    ...buildTokenGroupAccumulators()
                }
            },
            { $sort: { totalTokens: -1, requestCount: -1, _id: 1 } }
        ]),
        TokenUsageDaily.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$userId',
                    ...buildTokenGroupAccumulators()
                }
            },
            { $sort: { totalTokens: -1, requestCount: -1, _id: 1 } },
            { $limit: normalizedLimitUsers },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: {
                    path: '$user',
                    preserveNullAndEmptyArrays: true
                }
            }
        ]),
        TokenUsageFeatureDaily.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$featureKey',
                    tool: { $first: '$tool' },
                    ...buildTokenGroupAccumulators()
                }
            },
            { $sort: { totalTokens: -1, requestCount: -1, _id: 1 } },
            { $limit: normalizedLimitUsers }
        ]),
        TokenUsageDaily.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$userId'
                }
            },
            {
                $count: 'count'
            }
        ])
    ]);

    const totals = normalizeTokenUsage(totalsRaw[0] || ZERO_TOKEN_USAGE);

    totals.activeUsers = activeUsersRaw[0]?.count || 0;

    const timelineMap = new Map(
        timelineRaw.map((item) => [String(item._id || ''), normalizeTokenUsage(item)])
    );

    const timeline = bucketSeries.map((bucket) => ({
        bucket,
        ...(timelineMap.get(bucket) || zeroUsage)
    }));

    const knownTools = new Set(TOOL_ENUM);
    topToolsRaw.forEach((item) => {
        if (item?._id) {
            knownTools.add(item._id);
        }
    });
    timelineByToolRaw.forEach((item) => {
        if (item?._id?.tool) {
            knownTools.add(item._id.tool);
        }
    });

    const additionalTools = Array.from(knownTools)
        .filter((tool) => !TOOL_ENUM.includes(tool))
        .sort((a, b) => String(a).localeCompare(String(b)));
    const toolSeries = [...TOOL_ENUM, ...additionalTools];

    const timelineByToolMap = new Map(
        timelineByToolRaw.map((item) => {
            const bucket = String(item?._id?.bucket || '');
            const tool = item?._id?.tool || 'unknown';
            return [`${bucket}::${tool}`, normalizeTokenUsage(item)];
        })
    );

    const timelineByTool = bucketSeries.flatMap((bucket) => toolSeries.map((tool) => ({
        bucket,
        tool,
        ...(timelineByToolMap.get(`${bucket}::${tool}`) || zeroUsage)
    })));

    const topTools = topToolsRaw.map((item) => ({
        tool: item._id || 'unknown',
        ...normalizeTokenUsage(item)
    }));

    const topUsers = topUsersRaw.map((item) => ({
        userId: item._id ? String(item._id) : '',
        name: item.user?.name || 'Người dùng không xác định',
        email: item.user?.email || '',
        avatar: item.user?.avatar || undefined,
        ...normalizeTokenUsage(item)
    }));

    const topFeatures = topFeaturesRaw.map((item) => ({
        featureKey: item?._id || 'unknown',
        tool: item?.tool || 'unknown',
        ...normalizeTokenUsage(item)
    }));

    const discrepancy = buildDiscrepancy(totals);

    return {
        totals,
        timeline,
        timelineByTool,
        topTools,
        topUsers,
        topFeatures,
        discrepancy,
        chartMeta,
        range: {
            from: range.fromKey,
            to: range.toKey,
            groupBy: normalizedGroupBy,
            userId: userObjectId || null
        }
    };
}

function escapeRegex(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getTokenUsageUsers({ from, to, page = 1, limit = 20, search = '', userId = null } = {}) {
    const range = parseRangeQuery({ from, to });
    const normalizedPage = normalizeLimit(page, 1, 1, 100000);
    const normalizedLimit = normalizeLimit(limit, 20, 1, 100);
    const normalizedSearch = String(search || '').trim();
    const skip = (normalizedPage - 1) * normalizedLimit;
    const userObjectId = toObjectIdOrNull(userId);

    const matchStage = {
        dateKey: {
            $gte: range.fromKey,
            $lte: range.toKey
        }
    };

    if (userId && !userObjectId) {
        return {
            users: [],
            pagination: {
                page: normalizedPage,
                limit: normalizedLimit,
                total: 0,
                totalPages: 0
            },
            range: {
                from: range.fromKey,
                to: range.toKey,
                search: normalizedSearch,
                userId: null
            }
        };
    }

    if (userObjectId) {
        matchStage.userId = userObjectId;
    }

    const pipeline = [
        { $match: matchStage },
        {
            $group: {
                _id: '$userId',
                ...buildTokenGroupAccumulators(),
                firstRequestAt: { $min: '$firstRequestAt' },
                lastRequestAt: { $max: '$lastRequestAt' },
                lastUpdatedAt: { $max: '$updatedAt' },
                activeTools: { $addToSet: '$tool' }
            }
        },
        {
            $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'user'
            }
        },
        {
            $unwind: {
                path: '$user',
                preserveNullAndEmptyArrays: true
            }
        }
    ];

    if (normalizedSearch) {
        const escapedSearch = escapeRegex(normalizedSearch);
        pipeline.push({
            $match: {
                $or: [
                    { 'user.name': { $regex: escapedSearch, $options: 'i' } },
                    { 'user.email': { $regex: escapedSearch, $options: 'i' } }
                ]
            }
        });
    }

    pipeline.push(
        { $sort: { totalTokens: -1, requestCount: -1, _id: 1 } },
        {
            $facet: {
                items: [
                    { $skip: skip },
                    { $limit: normalizedLimit },
                    {
                        $project: {
                            _id: 0,
                            userId: { $toString: '$_id' },
                            name: { $ifNull: ['$user.name', 'Người dùng không xác định'] },
                            email: { $ifNull: ['$user.email', ''] },
                            role: { $ifNull: ['$user.role', 'user'] },
                            avatar: { $ifNull: ['$user.avatar', null] },
                            requestCount: 1,
                            promptTokens: 1,
                            completionTokens: 1,
                            totalTokens: 1,
                            supplementalTokens: 1,
                            thoughtTokens: 1,
                            cachedTokens: 1,
                            toolUseTokens: 1,
                            otherKnownTokens: 1,
                            explainedSupplementalTokens: 1,
                            unexplainedTokens: 1,
                            activeTools: {
                                $filter: {
                                    input: '$activeTools',
                                    as: 'toolName',
                                    cond: { $ne: ['$$toolName', null] }
                                }
                            },
                            firstUsedAt: '$firstRequestAt',
                            lastUsedAt: { $ifNull: ['$lastRequestAt', '$lastUpdatedAt'] },
                            updatedAt: '$lastUpdatedAt'
                        }
                    }
                ],
                totalCount: [
                    { $count: 'count' }
                ]
            }
        }
    );

    const aggregateResult = await TokenUsageDaily.aggregate(pipeline);
    const payload = aggregateResult[0] || { items: [], totalCount: [] };
    const total = payload.totalCount[0]?.count || 0;

    return {
        users: payload.items || [],
        pagination: {
            page: normalizedPage,
            limit: normalizedLimit,
            total,
            totalPages: total > 0 ? Math.ceil(total / normalizedLimit) : 0
        },
        range: {
            from: range.fromKey,
            to: range.toKey,
            search: normalizedSearch,
            userId: userObjectId ? String(userObjectId) : null
        }
    };
}

async function getRecentTokenUsageDebug({ limit = 20 } = {}) {
    const normalizedLimit = normalizeLimit(limit, 20, 1, 100);

    const records = await TokenUsageDaily.find({})
        .sort({ updatedAt: -1 })
        .limit(normalizedLimit)
        .select('dateKey userId tool requestCount totalTokens lastRequestAt updatedAt model')
        .lean();

    return {
        limit: normalizedLimit,
        items: records.map((item) => ({
            dateKey: item.dateKey,
            userId: item.userId ? String(item.userId) : '',
            tool: item.tool,
            requestCount: Number(item.requestCount) || 0,
            totalTokens: Number(item.totalTokens) || 0,
            lastRequestAt: item.lastRequestAt || null,
            updatedAt: item.updatedAt || null,
            model: item.model || ''
        }))
    };
}

module.exports = {
    VIETNAM_TIMEZONE,
    buildDateKeys,
    inferToolFromPath,
    inferFeatureFromPath,
    extractGeminiUsageMetadata,
    recordGeminiTokenUsage,
    parseRangeQuery,
    getTokenUsageSummary,
    getTokenUsageUsers,
    getRecentTokenUsageDebug
};
