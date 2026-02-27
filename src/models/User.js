const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRE || '15m';

const loginLocationSchema = new mongoose.Schema({
    country: {
        type: String,
        default: ''
    },
    region: {
        type: String,
        default: ''
    },
    city: {
        type: String,
        default: ''
    },
    timezone: {
        type: String,
        default: ''
    },
    source: {
        type: String,
        default: ''
    }
}, { _id: false });

const loginBrowserGeoSchema = new mongoose.Schema({
    latitude: {
        type: Number,
        default: null
    },
    longitude: {
        type: Number,
        default: null
    },
    accuracy: {
        type: Number,
        default: null
    },
    capturedAt: {
        type: Date,
        default: null
    }
}, { _id: false });

const loginDeviceMetaSchema = new mongoose.Schema({
    platform: {
        type: String,
        default: ''
    },
    language: {
        type: String,
        default: ''
    },
    timezone: {
        type: String,
        default: ''
    },
    screen: {
        type: String,
        default: ''
    },
    deviceMemory: {
        type: Number,
        default: null
    },
    deviceCores: {
        type: Number,
        default: null
    }
}, { _id: false });

const loginHistoryEntrySchema = new mongoose.Schema({
    sessionId: {
        type: String,
        default: ''
    },
    loggedInAt: {
        type: Date,
        default: Date.now
    },
    ip: {
        type: String,
        default: ''
    },
    userAgent: {
        type: String,
        default: ''
    },
    location: {
        type: loginLocationSchema,
        default: () => ({
            country: '',
            region: '',
            city: '',
            timezone: '',
            source: ''
        })
    },
    geoPermissionState: {
        type: String,
        default: 'unknown'
    },
    browserGeo: {
        type: loginBrowserGeoSchema,
        default: () => ({
            latitude: null,
            longitude: null,
            accuracy: null,
            capturedAt: null
        })
    },
    deviceMeta: {
        type: loginDeviceMetaSchema,
        default: () => ({
            platform: '',
            language: '',
            timezone: '',
            screen: '',
            deviceMemory: null,
            deviceCores: null
        })
    },
    revokedAt: {
        type: Date,
        default: null
    },
    revokeReason: {
        type: String,
        default: ''
    }
}, { _id: false });

const UserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: [true, 'Vui lòng nhập email'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [
            /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
            'Vui lòng nhập email hợp lệ'
        ]
    },
    password: {
        type: String,
        required: [true, 'Vui lòng nhập mật khẩu'],
        minlength: [6, 'Mật khẩu phải có ít nhất 6 ký tự'],
        select: false // Không trả về password trong query
    },
    name: {
        type: String,
        required: [true, 'Vui lòng nhập tên'],
        trim: true,
        maxlength: [50, 'Tên không được vượt quá 50 ký tự']
    },
    avatar: {
        type: String,
        default: ''
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    loginHistory: {
        type: [loginHistoryEntrySchema],
        default: []
    }
}, {
    timestamps: true
});

// Hash password trước khi save
UserSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// So sánh password
UserSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Tạo JWT token
UserSchema.methods.getSignedJwtToken = function () {
    return jwt.sign(
        { id: this._id },
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
    );
};

module.exports = mongoose.model('User', UserSchema);
