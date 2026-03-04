// src/routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/', notificationController.getNotifications);
router.patch('/:id/read', notificationController.markRead);

module.exports = router;