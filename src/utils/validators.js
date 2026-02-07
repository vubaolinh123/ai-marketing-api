/**
 * Validate email format
 * @param {string} email
 * @returns {boolean}
 */
const isValidEmail = (email) => {
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    return emailRegex.test(email);
};

/**
 * Validate password strength
 * @param {string} password
 * @returns {object} { isValid, message }
 */
const validatePassword = (password) => {
    if (!password) {
        return { isValid: false, message: 'Mật khẩu không được để trống' };
    }
    if (password.length < 6) {
        return { isValid: false, message: 'Mật khẩu phải có ít nhất 6 ký tự' };
    }
    return { isValid: true, message: '' };
};

/**
 * Validate required fields
 * @param {object} data
 * @param {string[]} requiredFields
 * @returns {object} { isValid, missingFields }
 */
const validateRequiredFields = (data, requiredFields) => {
    const missingFields = requiredFields.filter(field => !data[field]);
    return {
        isValid: missingFields.length === 0,
        missingFields
    };
};

module.exports = {
    isValidEmail,
    validatePassword,
    validateRequiredFields
};
