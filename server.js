require('dotenv').config();

const app = require('./src/app');
const { connectDB } = require('./src/config');
const { logStartup, logError } = require('./src/utils');

const PORT = process.env.PORT || 5000;

// Connect to database
connectDB();

const server = app.listen(PORT, () => {
    logStartup('Server listening', {
        mode: process.env.NODE_ENV,
        port: PORT
    });
    logStartup('API Health', {
        url: `http://localhost:${PORT}/api/health`
    });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
    logError('Unhandled promise rejection', { error: err });
    // Close server & exit process
    server.close(() => process.exit(1));
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logError('Uncaught exception', { error: err });
    process.exit(1);
});
