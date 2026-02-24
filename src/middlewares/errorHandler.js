const { logError } = require('../utils');

function logHttpError(err, req, statusCode, message) {
    logError('HTTP request error', {
        status: statusCode,
        method: req?.method,
        path: req?.originalUrl || req?.url,
        message,
        error: err
    });
}

const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;

    // Mongoose bad ObjectId
    if (err.name === 'CastError') {
        error.message = 'Không tìm thấy tài nguyên';
        logHttpError(err, req, 404, error.message);
        return res.status(404).json({
            success: false,
            message: error.message
        });
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        error.message = `${field === 'email' ? 'Email' : field} đã tồn tại`;
        logHttpError(err, req, 400, error.message);
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map(val => val.message);
        error.message = messages.join('. ');
        logHttpError(err, req, 400, error.message);
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        error.message = 'Token không hợp lệ';
        logHttpError(err, req, 401, error.message);
        return res.status(401).json({
            success: false,
            message: error.message
        });
    }

    if (err.name === 'TokenExpiredError') {
        error.message = 'Token đã hết hạn';
        logHttpError(err, req, 401, error.message);
        return res.status(401).json({
            success: false,
            message: error.message
        });
    }

    // Default error
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Lỗi server';
    logHttpError(err, req, statusCode, message);

    res.status(statusCode).json({
        success: false,
        message
    });
};

module.exports = errorHandler;
