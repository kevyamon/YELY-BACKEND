// src/routes/userRoutes.js
// ROUTES UTILISATEUR - Synchronisation avec le Contrôleur Forteresse
// CSCSM Level: Bank Grade

const express = require('express');
const userController = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { uploadProfilePic, validateFileSignature } = require('../middleware/uploadMiddleware');

const router = express.Router();

// Toutes les routes ci-dessous sont protégées par l'Iron Dome (JWT)
router.use(protect);

router.get('/profile', userController.getProfile);
router.patch('/update-profile', userController.updateProfile);
router.patch('/update-availability', userController.updateAvailability);

// Nouvelles routes d'Étape 1
router.patch('/profile-picture', uploadProfilePic, validateFileSignature, userController.uploadProfilePicture);
router.delete('/account', userController.deleteAccount);

module.exports = router;