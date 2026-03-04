// src/routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/', notificationController.getNotifications);
router.patch('/:id/read', notificationController.markRead);

// AJOUT SENIOR: Câblage de la route de suppression (Le cuisinier est maintenant relié à la salle !)
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;