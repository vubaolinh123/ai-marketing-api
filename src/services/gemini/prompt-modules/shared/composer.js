/**
 * Shared prompt composer utilities
 */

function normalizeBlock(block) {
    if (typeof block !== 'string') return '';
    return block.trim();
}

function composePromptBlocks(blocks = [], separator = '\n\n') {
    if (!Array.isArray(blocks)) return '';
    return blocks
        .map(normalizeBlock)
        .filter(Boolean)
        .join(separator)
        .trim();
}

module.exports = {
    normalizeBlock,
    composePromptBlocks
};
