const { AsyncLocalStorage } = require('async_hooks');

const requestContextStorage = new AsyncLocalStorage();

function runWithRequestContext(context, callback) {
    return requestContextStorage.run(context || {}, callback);
}

function getRequestContext() {
    return requestContextStorage.getStore() || {};
}

function appendRequestContext(partial) {
    const currentStore = requestContextStorage.getStore();
    if (!currentStore || !partial || typeof partial !== 'object') {
        return getRequestContext();
    }

    Object.assign(currentStore, partial);
    return currentStore;
}

module.exports = {
    runWithRequestContext,
    getRequestContext,
    appendRequestContext
};
