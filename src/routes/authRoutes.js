// backend/routes/authRoutes.js

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { registerUser, loginUser, logoutUser, updateAvailability } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');

// --- SCHÉMA DE VALIDATION (CONTRAT D'ENTRÉE) ---
const registerSchema = Joi.object({
  name: Joi.string().min(2).max(50).required().messages({
    'string.empty': "Le nom est obligatoire.",
    'string.min': "Le nom doit contenir au moins 2 caractères."
  }),
  email: Joi.string().email().required().messages({
    'string.email': "Veuillez fournir une adresse email valide.",
    'string.empty': "L'email est obligatoire."
  }),
  phone: Joi.string().min(8).max(15).required().messages({
    'string.empty': "Le numéro de téléphone est obligatoire.",
    'string.min': "Le numéro de téléphone semble trop court."
  }),
  password: Joi.string().min(6).required().messages({
    'string.min': "Le mot de passe doit contenir au moins 6 caractères.",
    'string.empty': "Le mot de passe est obligatoire."
  }),
  role: Joi.string().valid('rider', 'driver').messages({
    'any.only': "Le rôle doit être soit passager (rider) soit chauffeur (driver)."
  })
});

// --- ROUTES PUBLIQUES ---
router.post('/register', validate(registerSchema), registerUser);
router.post('/login', loginUser);
router.post('/logout', logoutUser);

// --- ROUTES PROTÉGÉES ---
router.put('/availability', protect, updateAvailability);

module.exports = router;