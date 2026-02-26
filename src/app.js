const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const cookieParser = require('cookie-parser');
const { errorHandler, requestLogger } = require('./middlewares');
const {
    authRoutes,
    userRoutes,
    aiSettingsRoutes,
    articleRoutes,
    uploadRoutes,
    aiRoutes,
    videoScriptRoutes,
    productImageRoutes,
    marketingPlanRoutes,
    adminRoutes
} = require('./routes');

const app = express();

// Security middlewares
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" } // Allow serving images cross-origin
}));

// CORS
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://marketing-ai-two.vercel.app'] 
        : ['http://localhost:3000', 'https://marketing-ai-two.vercel.app'],
    credentials: true
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// API request logger (error-focused by default)
app.use(requestLogger);

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health check route
app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'API is running',
        timestamp: new Date().toISOString()
    });
});

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ai-settings', aiSettingsRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/video-scripts', videoScriptRoutes);
app.use('/api/product-images', productImageRoutes);
app.use('/api/marketing-plan', marketingPlanRoutes);
app.use('/api/admin', adminRoutes);

// 404 handler
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        message: 'Route không tồn tại'
    });
});

// Global error handler
app.use(errorHandler);

module.exports = app;


