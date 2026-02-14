// src/routes/userRoutes.js
// ROUTES UTILISATEUR
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');
const { getMyProfile, updateProfile } = require('../controllers/userController');

// Schéma validation mise à jour
const updateProfileSchema = Joi.object({
  name: Joi.string().min(2).max(50).trim(),
  email: Joi.string().email().trim().lowercase(),
  phone: Joi.string().pattern(/^\+?[0-9\s]{8,20}$/).trim()
}).min(1); // Au moins un champ requis

// Routes protégées
router.use(protect);

router.get('/profile', getMyProfile);
router.put('/profile', validate(updateProfileSchema), updateProfile);

module.exports = router;