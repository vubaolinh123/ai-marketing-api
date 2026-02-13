/**
 * F&B photorealism guardrails module
 */

const FOOD_BEVERAGE_KEYWORDS = [
    'food', 'beverage', 'drink', 'tea', 'coffee', 'cake', 'dessert', 'meal', 'dish',
    'restaurant', 'kitchen', 'menu', 'snack', 'juice', 'cocktail', 'wine', 'beer',
    'rice', 'noodle', 'soup', 'pizza', 'burger', 'salad', 'steak', 'bakery',
    'do an', 'thuc an', 'thuc uong', 'do uong', 'nuoc uong', 'tra', 'ca phe', 'banh', 'trang mieng',
    'nha hang', 'quan', 'quan an', 'quan cafe', 'bep', 'thuc don', 'com', 'pho', 'bun', 'mi',
    'lau', 'nuong', 'chien', 'ran', 'xao', 'hap', 'mon an', 'dau bep', 'phuc vu',
    'an', 'uong', 'che bien', 'nau', 'am thuc', 'street food', 'do nuong', 'nuoc giai khat',
    'ăn', 'uống', 'chế biến', 'nấu', 'ẩm thực', 'đầu bếp', 'nhà hàng', 'quán', 'phục vụ', 'món ăn', 'đồ uống'
];

const CONSUMPTION_ACTION_KEYWORDS = [
    'eat', 'eating', 'drink', 'drinking', 'sip', 'sipping', 'bite', 'biting', 'taste', 'tasting',
    'an', 'uong', 'thuong thuc', 'nham nhi', 'dang an', 'dang uong', 'an uong',
    'ăn', 'uống', 'thưởng thức', 'nhâm nhi', 'đang ăn', 'đang uống', 'ăn uống'
];

const COOKING_ACTION_KEYWORDS = [
    'cook', 'cooking', 'prepare', 'preparing', 'grill', 'grilling', 'fry', 'frying',
    'roast', 'roasting', 'bake', 'baking', 'boil', 'boiling', 'plate', 'plating',
    'nau', 'che bien', 'nuong', 'ran', 'chien', 'xao', 'hap', 'len mon',
    'nấu', 'chế biến', 'nướng', 'rán', 'chiên', 'xào', 'hấp', 'lên món'
];

const SERVING_ACTION_KEYWORDS = [
    'serve', 'serving', 'served', 'waiter', 'waitress', 'bring out', 'presenting',
    'phuc vu', 'don mon', 'mang mon', 'dua mon', 'goi mon',
    'phục vụ', 'dọn món', 'mang món', 'đưa món', 'gọi món'
];

const PLATING_ACTION_KEYWORDS = [
    'plating', 'plate', 'arrange', 'arranging', 'presentation', 'garnish', 'finishing touch',
    'bay tri', 'trinh bay mon', 'len dia',
    'bày trí', 'trình bày món', 'lên đĩa'
];

const HUMAN_INTERACTION_KEYWORDS = [
    'person', 'people', 'human', 'customer', 'diner', 'server', 'chef', 'hands', 'holding', 'using',
    'nguoi', 'con nguoi', 'khach hang', 'thuc khach', 'phuc vu', 'dau bep', 'ban tay', 'cam', 'su dung', 'tuong tac'
];

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function includesAnyKeyword(text, keywords = []) {
    const normalizedText = normalizeText(text);

    return keywords.some((keyword) => {
        const normalizedKeyword = normalizeText(keyword);
        if (!normalizedKeyword) return false;

        const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
        return pattern.test(normalizedText);
    });
}

function buildContextText(context = {}) {
    const fields = [
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
        context.brandContext,
        context.action,
        context.actionType,
        context.sceneAction,
        context.userPrompt,
        context.prompt,
        context.description,
        context.concept
    ];

    return normalizeText(fields
        .filter((value) => typeof value === 'string' && value.trim())
        .join(' '));
}

function detectFoodBeverageContext(context = {}) {
    const text = buildContextText(context);

    return includesAnyKeyword(text, FOOD_BEVERAGE_KEYWORDS)
        || includesAnyKeyword(text, CONSUMPTION_ACTION_KEYWORDS)
        || includesAnyKeyword(text, COOKING_ACTION_KEYWORDS)
        || includesAnyKeyword(text, SERVING_ACTION_KEYWORDS)
        || includesAnyKeyword(text, PLATING_ACTION_KEYWORDS);
}

function detectActionIntents(context = {}) {
    if (context.intentSignals) {
        return {
            wantsEatingAction: !!context.intentSignals.wantsEatingAction,
            wantsCookingAction: !!context.intentSignals.wantsCookingAction,
            wantsHumanInteraction: !!context.intentSignals.wantsHumanInteraction
        };
    }

    const text = buildContextText(context);

    return {
        wantsEatingAction: includesAnyKeyword(text, CONSUMPTION_ACTION_KEYWORDS),
        wantsCookingAction: includesAnyKeyword(text, COOKING_ACTION_KEYWORDS),
        wantsServingAction: includesAnyKeyword(text, SERVING_ACTION_KEYWORDS),
        wantsPlatingAction: includesAnyKeyword(text, PLATING_ACTION_KEYWORDS),
        wantsHumanInteraction: includesAnyKeyword(text, HUMAN_INTERACTION_KEYWORDS)
    };
}

function buildFnbPhotorealGuardrails(context = {}) {
    const isFoodBeverage = detectFoodBeverageContext(context);
    if (!isFoodBeverage) {
        return {
            isFoodBeverage,
            block: ''
        };
    }

    const {
        wantsEatingAction,
        wantsCookingAction,
        wantsServingAction,
        wantsPlatingAction,
        wantsHumanInteraction
    } = detectActionIntents(context);

    const allowHumanAction = wantsEatingAction
        || wantsCookingAction
        || wantsServingAction
        || wantsPlatingAction
        || wantsHumanInteraction;

    const lines = [
        '### F&B PHOTOREALISM GUARDRAILS',
        '- Keep food/beverage appearance physically plausible and appetizing in real-world photography style.',
        '- Preserve realistic edible details: surface texture, moisture, oil sheen, steam/condensation (when temperature-appropriate), and ingredient structure.',
        '- Maintain natural portion sizes and accurate scale between dish, cup, utensils, tableware, and hands.',
        '- Ensure interactions with food are physically believable (contact points, gravity, drips, crumbs, utensil use).',
        '- Hard negative: no CGI/3D-render look, no waxy/plastic food surfaces, no toy-like geometry, no surreal saturation shifts.',
        '- Garnish discipline: do not inject random herbs/sauces/decorative toppings unless explicitly requested or clearly authentic to the described dish.'
    ];

    if (allowHumanAction) {
        lines.push('- Positive action rule: Allow natural human interaction (eating/drinking/cooking/serving/plating) only when requested by scene intent.');
        lines.push('- Even with human action, keep product identity lock and key product details clearly recognizable.');
    }

    if (wantsPlatingAction) {
        lines.push('- For plating scenes, keep arrangement intentional and cuisine-consistent; avoid random garnish scatter.');
    }

    return {
        isFoodBeverage,
        block: lines.join('\n')
    };
}

module.exports = {
    detectFoodBeverageContext,
    buildFnbPhotorealGuardrails
};
