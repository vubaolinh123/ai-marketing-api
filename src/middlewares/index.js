const { protect, authorize } = require('./auth');
const errorHandler = require('./errorHandler');

module.exports = {
    protect,
    authorize,
    errorHandler
};
