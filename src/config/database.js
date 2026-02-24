const mongoose = require('mongoose');
const { logStartup, logError } = require('../utils');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            // Mongoose 8 không cần các options này nữa
        });

        logStartup('MongoDB connected', {
            host: conn.connection.host
        });
    } catch (error) {
        logError('MongoDB connection failed', { error });
        process.exit(1);
    }
};

module.exports = connectDB;
