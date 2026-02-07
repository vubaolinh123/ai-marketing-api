const { User } = require('../models');

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res, next) => {
    try {
        const { name, email, password } = req.body;

        // Create user
        const user = await User.create({
            name,
            email,
            password
        });

        // Create token and send response
        sendTokenResponse(user, 201, res, 'Đăng ký thành công');
    } catch (error) {
        next(error);
    }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        // Validate email & password
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập email và mật khẩu'
            });
        }

        // Check for user
        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Email hoặc mật khẩu không đúng'
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'Tài khoản đã bị vô hiệu hóa'
            });
        }

        // Check if password matches
        const isMatch = await user.matchPassword(password);

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Email hoặc mật khẩu không đúng'
            });
        }

        // Create token and send response
        sendTokenResponse(user, 200, res, 'Đăng nhập thành công');
    } catch (error) {
        next(error);
    }
};

// @desc    Logout user (clear token client-side)
// @route   POST /api/auth/logout
// @access  Private
const logout = async (req, res, next) => {
    try {
        res.status(200).json({
            success: true,
            message: 'Đăng xuất thành công',
            data: {}
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);

        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        next(error);
    }
};

// Helper function to get token from model and send response
const sendTokenResponse = (user, statusCode, res, message) => {
    const token = user.getSignedJwtToken();

    res.status(statusCode).json({
        success: true,
        message,
        data: {
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                avatar: user.avatar,
                role: user.role
            }
        }
    });
};

module.exports = {
    register,
    login,
    logout,
    getMe
};
