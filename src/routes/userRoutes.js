// src/routes/userRoutes.js
// ROUTES UTILISATEUR - Synchronisation avec le Contrôleur Forteresse
// CSCSM Level: Bank Grade

const express = require('express');
const userController = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Toutes les routes ci-dessous sont protégées par l'Iron Dome (JWT)
router.use(protect);

// 🚀 SYNC : On utilise les noms exacts du contrôleur
router.get('/profile', userController.getProfile);
router.patch('/update-profile', userController.updateProfile);
router.patch('/update-availability', userController.updateAvailability);

module.exports = router;