const mongoose = require('mongoose');
const { TokenUsageDaily } = require('../models');
const { getRequestContext } = require('../utils/logContext');
const { logWarn, logError } = require('../utils/logger');

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_PROVIDER = 'google-gemini';
const TOOL_ENUM = ['article', 'image', 'video', 'marketing', 'unknown'];

function toPositiveNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
    }
    return numeric;
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

function inferToolFromPath(path = '') {
    const normalizedPath = String(path || '').trim();

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

function extractGeminiUsageMetadata(responsePayload) {
    const usageMetadata = responsePayload?.response?.usageMetadata || responsePayload?.usageMetadata || null;
    if (!usageMetadata) {
        return {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0
        };
    }

    const promptTokens = toPositiveNumber(usageMetadata.promptTokenCount);
    const completionTokens = toPositiveNumber(usageMetadata.candidatesTokenCount);
    let totalTokens = toPositiveNumber(usageMetadata.totalTokenCount);

    if (!totalTokens && (promptTokens || completionTokens)) {
        totalTokens = promptTokens + completionTokens;
    }

    return {
        promptTokens,
        completionTokens,
        totalTokens
    };
}

async function recordGeminiTokenUsage({ modelName, operation, responsePayload } = {}) {
    try {
        const context = getRequestContext();
        const effectiveUserId = toObjectIdOrNull(context.effectiveUserId);
        if (!effectiveUserId) {
            return;
        }

        const usage = extractGeminiUsageMetadata(responsePayload);
        if (usage.totalTokens <= 0 && usage.promptTokens <= 0 && usage.completionTokens <= 0) {
            return;
        }

        const now = new Date();
        const { dateKey, monthKey, weekKey } = buildDateKeys(now);
        const tool = inferToolFromPath(context.inboundPath);
        const actorUserId = toObjectIdOrNull(context.actorUserId);

        await TokenUsageDaily.findOneAndUpdate(
            {
                dateKey,
                userId: effectiveUserId,
                tool,
                provider: DEFAULT_PROVIDER
            },
            {
                $set: {
                    weekKey,
                    monthKey,
                    actorUserId,
                    isImpersonating: !!context.isImpersonating,
                    model: modelName || '',
                    lastRequestAt: now
                },
                $setOnInsert: {
                    dateKey,
                    userId: effectiveUserId,
                    tool,
                    provider: DEFAULT_PROVIDER,
                    firstRequestAt: now
                },
                $inc: {
                    requestCount: 1,
                    promptTokens: usage.promptTokens,
                    completionTokens: usage.completionTokens,
                    totalTokens: usage.totalTokens
                }
            },
            {
                upsert: true
            }
        );
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

async function getTokenUsageSummary({ from, to, groupBy = 'day', userId = null, limitUsers = 20 } = {}) {
    const range = parseRangeQuery({ from, to });
    const normalizedGroupBy = normalizeGroupBy(groupBy);
    const normalizedLimitUsers = normalizeLimit(limitUsers, 20, 1, 100);
    const userObjectId = toObjectIdOrNull(userId);

    const match = {
        dateKey: {
            $gte: range.fromKey,
            $lte: range.toKey
        }
    };

    if (userId && !userObjectId) {
        return {
            totals: {
                requestCount: 0,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0
            },
            timeline: [],
            topTools: TOOL_ENUM.map((tool) => ({
                tool,
                requestCount: 0,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0
            })),
            topUsers: [],
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
        ? '$weekKey'
        : normalizedGroupBy === 'month'
            ? '$monthKey'
            : '$dateKey';

    const [totalsRaw, timelineRaw, topToolsRaw, topUsersRaw, activeUsersRaw] = await Promise.all([
        TokenUsageDaily.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    requestCount: { $sum: '$requestCount' },
                    promptTokens: { $sum: '$promptTokens' },
                    completionTokens: { $sum: '$completionTokens' },
                    totalTokens: { $sum: '$totalTokens' }
                }
            }
        ]),
        TokenUsageDaily.aggregate([
            { $match: match },
            {
                $group: {
                    _id: timelineBucketField,
                    requestCount: { $sum: '$requestCount' },
                    promptTokens: { $sum: '$promptTokens' },
                    completionTokens: { $sum: '$completionTokens' },
                    totalTokens: { $sum: '$totalTokens' }
                }
            },
            { $sort: { _id: 1 } }
        ]),
        TokenUsageDaily.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$tool',
                    requestCount: { $sum: '$requestCount' },
                    promptTokens: { $sum: '$promptTokens' },
                    completionTokens: { $sum: '$completionTokens' },
                    totalTokens: { $sum: '$totalTokens' }
                }
            },
            { $sort: { totalTokens: -1, requestCount: -1, _id: 1 } }
        ]),
        TokenUsageDaily.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$userId',
                    requestCount: { $sum: '$requestCount' },
                    promptTokens: { $sum: '$promptTokens' },
                    completionTokens: { $sum: '$completionTokens' },
                    totalTokens: { $sum: '$totalTokens' }
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

    const totals = totalsRaw[0] || {
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
    };

    totals.activeUsers = activeUsersRaw[0]?.count || 0;

    const timeline = timelineRaw.map((item) => ({
        bucket: item._id,
        requestCount: item.requestCount || 0,
        promptTokens: item.promptTokens || 0,
        completionTokens: item.completionTokens || 0,
        totalTokens: item.totalTokens || 0
    }));

    const topTools = topToolsRaw.map((item) => ({
        tool: item._id,
        requestCount: item.requestCount || 0,
        promptTokens: item.promptTokens || 0,
        completionTokens: item.completionTokens || 0,
        totalTokens: item.totalTokens || 0
    }));

    const topUsers = topUsersRaw.map((item) => ({
        userId: String(item._id),
        name: item.user?.name || 'Người dùng không xác định',
        email: item.user?.email || '',
        avatar: item.user?.avatar || undefined,
        requestCount: item.requestCount || 0,
        promptTokens: item.promptTokens || 0,
        completionTokens: item.completionTokens || 0,
        totalTokens: item.totalTokens || 0
    }));

    return {
        totals,
        timeline,
        topTools,
        topUsers,
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
                requestCount: { $sum: '$requestCount' },
                promptTokens: { $sum: '$promptTokens' },
                completionTokens: { $sum: '$completionTokens' },
                totalTokens: { $sum: '$totalTokens' },
                firstRequestAt: { $min: '$firstRequestAt' },
                lastRequestAt: { $max: '$lastRequestAt' },
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
                            activeTools: {
                                $filter: {
                                    input: '$activeTools',
                                    as: 'toolName',
                                    cond: { $ne: ['$$toolName', null] }
                                }
                            },
                            firstUsedAt: '$firstRequestAt',
                            lastUsedAt: '$lastRequestAt'
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

module.exports = {
    VIETNAM_TIMEZONE,
    buildDateKeys,
    inferToolFromPath,
    extractGeminiUsageMetadata,
    recordGeminiTokenUsage,
    parseRangeQuery,
    getTokenUsageSummary,
    getTokenUsageUsers
};
