/**
 * F&B photorealism guardrails module
 */

const FOOD_BEVERAGE_KEYWORDS = [
    'food', 'beverage', 'drink', 'tea', 'coffee', 'cake', 'dessert', 'meal', 'dish',
    'restaurant', 'kitchen', 'menu', 'snack', 'juice', 'cocktail', 'wine', 'beer',
    'rice', 'noodle', 'soup', 'pizza', 'burger', 'salad', 'steak', 'bakery'
];

function detectFoodBeverageContext(context = {}) {
    const text = [
        context.backgroundType,
        context.customBackground,
        context.additionalNotes,
        context.usagePurpose,
        context.displayInfo,
        context.visualStyle,
        context.targetAudience,
        context.productType,
        context.category,
        context.subcategory,
        context.industry,
        context.summary,
        context.brandContext
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return FOOD_BEVERAGE_KEYWORDS.some((keyword) => text.includes(keyword));
}

function buildFnbPhotorealGuardrails(context = {}) {
    const isFoodBeverage = detectFoodBeverageContext(context);
    if (!isFoodBeverage) {
        return {
            isFoodBeverage,
            block: ''
        };
    }

    return {
        isFoodBeverage,
        block: [
            '### F&B PHOTOREALISM GUARDRAILS',
            '- Keep food/beverage appearance physically plausible and appetizing.',
            '- Preserve realistic moisture, texture, steam, reflections, and ingredient structure.',
            '- Avoid artificial plastic-like surfaces, over-smoothing, or surreal color shifts.',
            '- Maintain natural portion sizes, utensil scale, and serving context.',
            '- Keep plating and garnishes coherent across all angles.'
        ].join('\n')
    };
}

module.exports = {
    detectFoodBeverageContext,
    buildFnbPhotorealGuardrails
};
