const { AISettings } = require('../models');

// Default settings structure
const defaultSettings = {
    logo: {
        brandName: '',
        logoUrl: '',
        brandIdentity: '',
        resourceLinks: []
    },
    colors: {
        primaryColor: '#F59E0B',
        backgroundColor: '#1a1a1a',
        accentColor: '#0891b2'
    },
    language: {
        keywords: [],
        customerTerm: ''
    },
    tone: {
        overallTone: [],
        contextDescriptions: []
    },
    product: {
        productGroups: [],
        strengths: '',
        suitableFor: []
    },
    facebook: {
        facebookToken: ''
    },
    aiModels: {
        textModel: 'gemini-2.5-flash',
        visionModel: 'gemini-2.0-flash',
        imageGenModel: 'gemini-2.0-flash-exp-image-generation'
    }
};

// @desc    Get AI settings for current user
// @route   GET /api/ai-settings
// @access  Private
const getSettings = async (req, res, next) => {
    try {
        let settings = await AISettings.findOne({ userId: req.user.id });

        // If no settings exist, return default
        if (!settings) {
            return res.status(200).json({
                success: true,
                data: {
                    userId: req.user.id,
                    ...defaultSettings
                }
            });
        }

        res.status(200).json({
            success: true,
            data: settings
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update AI settings (create if not exist)
// @route   PUT /api/ai-settings
// @access  Private
const updateSettings = async (req, res, next) => {
    try {
        const { logo, colors, language, tone, product, facebook, aiModels } = req.body;

        const updateData = {};
        if (logo !== undefined) updateData.logo = logo;
        if (colors !== undefined) updateData.colors = colors;
        if (language !== undefined) updateData.language = language;
        if (tone !== undefined) updateData.tone = tone;
        if (product !== undefined) updateData.product = product;
        if (facebook !== undefined) updateData.facebook = facebook;
        if (aiModels !== undefined) updateData.aiModels = aiModels;

        let settings = await AISettings.findOneAndUpdate(
            { userId: req.user.id },
            { $set: updateData },
            { new: true, upsert: true, runValidators: true }
        );

        res.status(200).json({
            success: true,
            message: 'Cập nhật cài đặt thành công',
            data: settings
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update specific section of AI settings
// @route   PATCH /api/ai-settings/:section
// @access  Private
const updateSection = async (req, res, next) => {
    try {
        const { section } = req.params;
        const validSections = ['logo', 'colors', 'language', 'tone', 'product', 'facebook', 'aiModels'];

        if (!validSections.includes(section)) {
            return res.status(400).json({
                success: false,
                message: `Section không hợp lệ. Chỉ chấp nhận: ${validSections.join(', ')}`
            });
        }

        const updateData = {
            [section]: req.body
        };

        let settings = await AISettings.findOneAndUpdate(
            { userId: req.user.id },
            { $set: updateData },
            { new: true, upsert: true, runValidators: true }
        );

        res.status(200).json({
            success: true,
            message: `Cập nhật ${section} thành công`,
            data: settings
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getSettings,
    updateSettings,
    updateSection
};
