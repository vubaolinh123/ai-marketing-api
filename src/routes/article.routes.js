const express = require('express');
const router = express.Router();
const articleController = require('../controllers/article.controller');
const { protect } = require('../middlewares');

// All routes require authentication
router.use(protect);

// CRUD routes
router.route('/')
    .post(articleController.createArticle)
    .get(articleController.getArticles);

router.route('/:id')
    .get(articleController.getArticle)
    .put(articleController.updateArticle)
    .delete(articleController.deleteArticle);

module.exports = router;
