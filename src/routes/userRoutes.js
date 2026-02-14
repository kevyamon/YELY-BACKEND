// src/routes/userRoutes.js
// ROUTES UTILISATEUR - Validation Zod
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');
const { getMyProfile, updateProfile } = require('../controllers/userController');

// Schéma validation Zod
const updateProfileSchema = z.object({
  name: z.string().min(2).max(50).trim().optional(),
  email: z.string().email().trim().toLowerCase().optional(),
  phone: z.string().regex(/^\+?[0-9\s]{8,20}$/).trim().optional()
}).refine(data => Object.keys(data).length > 0, {
  message: "Au moins un champ est requis pour la mise à jour"
});

// Routes protégées
router.use(protect);

router.get('/profile', getMyProfile);
router.put('/profile', validate(updateProfileSchema), updateProfile);

module.exports = router;