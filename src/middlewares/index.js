const { protect, authorize } = require('./auth');
const errorHandler = require('./errorHandler');
const requestLogger = require('./requestLogger');

module.exports = {
    protect,
    authorize,
    errorHandler,
    requestLogger
};
