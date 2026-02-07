/**
 * Marketing Plan Controller
 * Handles API endpoints for marketing plan generation
 */

const geminiService = require('../services/gemini');
const { getModelForTask } = require('../services/gemini/modelConfig.service');
const { MarketingPlan, AISettings } = require('../models');

/**
 * Generate marketing plan with AI
 * POST /api/marketing-plan/generate
 */
exports.generateMarketingPlan = async (req, res) => {
    console.log('📋 [Marketing Plan] Generate request received');
    console.log('   User:', req.user?._id);
    console.log('   Body:', JSON.stringify(req.body, null, 2));
    
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
            useBrandSettings
        } = req.body;

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
                brandContext = geminiService.buildBrandContext(aiSettings);
            }
        }

        // Get user's selected model for text generation
        const textModel = await getModelForTask('text', req.user._id);

        // Prepare input for AI
        const input = {
            campaignName,
            startDate,
            endDate,
            postsPerWeek: parseInt(postsPerWeek) || 5,
            postTimes: postTimes || ['18:00'],
            topics,
            goals: goals || [],
            channels,
            notes: notes || ''
        };

        console.log('📋 [Marketing Plan] Calling Gemini AI...');
        console.log('   Model:', textModel);
        console.log('   Brand context:', brandContext ? 'Yes' : 'No');

        // Generate plan with AI
        const posts = await geminiService.generateMarketingPlan(input, brandContext, textModel);
        
        console.log('📋 [Marketing Plan] AI generated', posts?.length, 'posts');

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
