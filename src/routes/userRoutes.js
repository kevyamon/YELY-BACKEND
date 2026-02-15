// src/routes/userRoutes.js
// ROUTES UTILISATEUR - Blindage & Validation
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');
const { updateProfileSchema } = require('../validations/userValidation');

router.use(protect);

router.get('/profile', userController.getMyProfile);
router.put('/profile', validate(updateProfileSchema), userController.updateProfile);

module.exports = router;