/**
 * Marketing Plan Controller
 * Handles API endpoints for marketing plan generation
 */

const geminiService = require('../services/gemini');
const { getModelForTask } = require('../services/gemini/modelConfig.service');
const { MarketingPlan, AISettings } = require('../models');
const { logPromptDebug } = require('../utils/promptDebug');

function hasMeaningfulValue(value) {
    if (typeof value === 'string') {
        return value.trim().length > 0;
    }

    if (Array.isArray(value)) {
        return value.some((item) => hasMeaningfulValue(item));
    }

    if (value && typeof value === 'object') {
        return Object.values(value).some((item) => hasMeaningfulValue(item));
    }

    if (typeof value === 'number') {
        return Number.isFinite(value);
    }

    if (typeof value === 'boolean') {
        return true;
    }

    return false;
}

function normalizeStrategySuggestionInput(strategySuggestion) {
    if (typeof strategySuggestion === 'string') {
        return strategySuggestion.trim();
    }

    if (strategySuggestion && typeof strategySuggestion === 'object' && !Array.isArray(strategySuggestion)) {
        return strategySuggestion;
    }

    return '';
}

/**
 * Generate marketing plan with AI
 * POST /api/marketing-plan/generate
 */
exports.generateMarketingPlan = async (req, res) => {
    try {
        const {
            campaignName,
            startDate,
            endDate,
            postsPerWeek,
            postTimes,
            topics,
            goals,
            channels,
            notes,
            priorityProductService,
            monthlyFocus,
            promotions,
            customerJourneyStage,
            targetSegment,
            strategySuggestion,
            useBrandSettings
        } = req.body;

        logPromptDebug({
            tool: 'marketing',
            step: 'received-input',
            data: {
                campaignName,
                startDate,
                endDate,
                postsPerWeek,
                postTimes,
                topics,
                goals,
                channels,
                notes,
                priorityProductService,
                monthlyFocus,
                promotions,
                customerJourneyStage,
                targetSegment,
                strategySuggestion,
                useBrandSettings
            }
        });

        // Validate required fields
        if (!campaignName) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập tên chiến dịch'
            });
        }

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng chọn ngày bắt đầu và kết thúc'
            });
        }

        if (!topics || topics.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập ít nhất một chủ đề'
            });
        }

        if (!channels || channels.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng chọn ít nhất một kênh đăng'
            });
        }

        // Fetch brand context if enabled
        let brandContext = null;
        if (useBrandSettings) {
            const aiSettings = await AISettings.findOne({ userId: req.user._id });
            if (aiSettings) {
                try {
                    brandContext = await geminiService.buildRichBrandContext(aiSettings);
                } catch (error) {
                    brandContext = geminiService.buildBrandContext(aiSettings);
                }
            }
        }

        logPromptDebug({
            tool: 'marketing',
            step: 'brand-context',
            data: {
                enabled: !!useBrandSettings,
                available: !!brandContext,
                preview: brandContext
            }
        });

        // Get user's selected model for text generation
        const textModel = await getModelForTask('text', req.user._id);

        // Prepare input for AI
        const normalizedStrategySuggestion = normalizeStrategySuggestionInput(strategySuggestion);

        const input = {
            campaignName,
            startDate,
            endDate,
            postsPerWeek: parseInt(postsPerWeek) || 5,
            postTimes: postTimes || ['18:00'],
            topics,
            goals: goals || [],
            channels,
            notes: notes || '',
            priorityProductService: priorityProductService || '',
            monthlyFocus: monthlyFocus || '',
            promotions: promotions || '',
            customerJourneyStage: customerJourneyStage || '',
            targetSegment: targetSegment || '',
            strategySuggestion: normalizedStrategySuggestion
        };

        // Generate plan with AI
        const posts = await geminiService.generateMarketingPlan(input, brandContext, textModel);

        logPromptDebug({
            tool: 'marketing',
            step: 'ai-response',
            data: {
                modelName: textModel,
                totalPosts: posts?.length || 0
            }
        });

        // Save to database
        const plan = await MarketingPlan.create({
            userId: req.user._id,
            campaignName,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            postsPerWeek: input.postsPerWeek,
            postTimes: input.postTimes,
            topics,
            goals: input.goals,
            channels,
            notes: input.notes,
            priorityProductService: input.priorityProductService,
            monthlyFocus: input.monthlyFocus,
            promotions: input.promotions,
            customerJourneyStage: input.customerJourneyStage,
            targetSegment: input.targetSegment,
            strategySuggestion: input.strategySuggestion,
            useBrandSettings: !!useBrandSettings,
            posts,
            totalPosts: posts.length,
            status: 'active'
        });

        res.status(201).json({
            success: true,
            message: 'Tạo kế hoạch marketing thành công',
            data: {
                id: plan._id,
                campaignName: plan.campaignName,
                startDate: plan.startDate,
                endDate: plan.endDate,
                posts: plan.posts,
                totalPosts: plan.totalPosts,
                createdAt: plan.createdAt
            }
        });
    } catch (error) {
        logPromptDebug({
            tool: 'marketing',
            step: 'ai-response-error',
            data: {
                message: error?.message,
                stack: error?.stack
            }
        });
        console.error('Generate marketing plan error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi tạo kế hoạch marketing'
        });
    }
};

/**
 * Get all marketing plans for current user
 * GET /api/marketing-plan
 */
exports.getAllPlans = async (req, res) => {
    try {
        const { page = 1, limit = 10, status } = req.query;
        
        const query = { userId: req.user._id };
        if (status) {
            query.status = status;
        }

        const plans = await MarketingPlan.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .select('-posts'); // Exclude posts for list view

        const total = await MarketingPlan.countDocuments(query);

        res.status(200).json({
            success: true,
            data: {
                plans,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Get all plans error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi lấy danh sách kế hoạch'
        });
    }
};

/**
 * Get marketing plan by ID
 * GET /api/marketing-plan/:id
 */
exports.getPlanById = async (req, res) => {
    try {
        const { id } = req.params;

        const plan = await MarketingPlan.findOne({
            _id: id,
            userId: req.user._id
        });

        if (!plan) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy kế hoạch marketing'
            });
        }

        res.status(200).json({
            success: true,
            data: plan
        });
    } catch (error) {
        console.error('Get plan by ID error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi lấy chi tiết kế hoạch'
        });
    }
};

/**
 * Delete marketing plan
 * DELETE /api/marketing-plan/:id
 */
exports.deletePlan = async (req, res) => {
    try {
        const { id } = req.params;

        const plan = await MarketingPlan.findOneAndDelete({
            _id: id,
            userId: req.user._id
        });

        if (!plan) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy kế hoạch marketing'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Xóa kế hoạch marketing thành công'
        });
    } catch (error) {
        console.error('Delete plan error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi xóa kế hoạch'
        });
    }
};

/**
 * Update plan status
 * PATCH /api/marketing-plan/:id/status
 */
exports.updatePlanStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['active', 'completed', 'draft'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Trạng thái không hợp lệ'
            });
        }

        const plan = await MarketingPlan.findOneAndUpdate(
            { _id: id, userId: req.user._id },
            { status },
            { new: true }
        );

        if (!plan) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy kế hoạch marketing'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Cập nhật trạng thái thành công',
            data: plan
        });
    } catch (error) {
        console.error('Update plan status error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi cập nhật trạng thái'
        });
    }
};

/**
 * Suggest monthly strategy using AI
 * POST /api/marketing-plan/suggest-strategy
 */
exports.suggestMonthlyStrategy = async (req, res) => {
    try {
        const {
            campaignName,
            startDate,
            endDate,
            topics,
            goals,
            channels,
            notes,
            priorityProductService,
            monthlyFocus,
            promotions,
            customerJourneyStage,
            targetSegment,
            strategySuggestion,
            useBrandSettings
        } = req.body;

        logPromptDebug({
            tool: 'marketing',
            step: 'received-input',
            data: {
                mode: 'suggest-monthly-strategy',
                campaignName,
                startDate,
                endDate,
                topics,
                goals,
                channels,
                notes,
                priorityProductService,
                monthlyFocus,
                promotions,
                customerJourneyStage,
                targetSegment,
                strategySuggestion,
                useBrandSettings
            }
        });

        const hasAnyInput = [
            campaignName,
            monthlyFocus,
            priorityProductService,
            promotions,
            customerJourneyStage,
            targetSegment,
            strategySuggestion,
            notes,
            ...(Array.isArray(topics) ? topics : []),
            ...(Array.isArray(goals) ? goals : []),
            ...(Array.isArray(channels) ? channels : [])
        ].some((value) => hasMeaningfulValue(value));

        if (!hasAnyInput) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp ít nhất một thông tin để gợi ý chiến lược'
            });
        }

        let brandContext = null;
        if (useBrandSettings) {
            const aiSettings = await AISettings.findOne({ userId: req.user._id });
            if (aiSettings) {
                try {
                    brandContext = await geminiService.buildRichBrandContext(aiSettings);
                } catch (error) {
                    brandContext = geminiService.buildBrandContext(aiSettings);
                }
            }
        }

        logPromptDebug({
            tool: 'marketing',
            step: 'brand-context',
            data: {
                enabled: !!useBrandSettings,
                available: !!brandContext,
                preview: brandContext
            }
        });

        const textModel = await getModelForTask('text', req.user._id);

        const normalizedStrategySuggestion = normalizeStrategySuggestionInput(strategySuggestion);

        const strategy = await geminiService.generateMonthlyStrategy({
            campaignName: campaignName || '',
            startDate,
            endDate,
            topics: Array.isArray(topics) ? topics : [],
            goals: Array.isArray(goals) ? goals : [],
            channels: Array.isArray(channels) ? channels : [],
            notes: notes || '',
            priorityProductService: priorityProductService || '',
            monthlyFocus: monthlyFocus || '',
            promotions: promotions || '',
            customerJourneyStage: customerJourneyStage || '',
            targetSegment: targetSegment || '',
            strategySuggestion: normalizedStrategySuggestion
        }, brandContext, textModel);

        logPromptDebug({
            tool: 'marketing',
            step: 'ai-response',
            data: {
                mode: 'suggest-monthly-strategy',
                modelName: textModel,
                strategyPreview: strategy
            }
        });

        res.status(200).json({
            success: true,
            message: 'Gợi ý chiến lược thành công',
            data: strategy
        });
    } catch (error) {
        logPromptDebug({
            tool: 'marketing',
            step: 'ai-response-error',
            data: {
                mode: 'suggest-monthly-strategy',
                message: error?.message,
                stack: error?.stack
            }
        });
        console.error('Suggest monthly strategy error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi gợi ý chiến lược tháng'
        });
    }
};
