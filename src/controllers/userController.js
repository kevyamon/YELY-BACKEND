// src/controllers/userController.js
// CONTRÔLEUR UTILISATEUR - Gestion Profil & Disponibilité
// CSCSM Level: Bank Grade

const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const AppError = require('../utils/AppError');

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) throw new AppError('Utilisateur introuvable', 404);
    return successResponse(res, user, 'Profil récupéré');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const updateProfile = async (req, res) => {
  try {
    const allowedUpdates = ['name', 'phone', 'vehicle'];
    const updates = Object.keys(req.body);
    const isValidOperation = updates.every(update => allowedUpdates.includes(update));

    if (!isValidOperation) throw new AppError('Mise à jour non autorisée', 400);

    const user = await User.findByIdAndUpdate(req.user._id, req.body, {
      new: true,
      runValidators: true
    }).select('-password');

    return successResponse(res, user, 'Profil mis à jour');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

// 🚀 CORRECTION : Mise à jour de la disponibilité (En ligne / Hors ligne)
const updateAvailability = async (req, res) => {
  try {
    const { isAvailable } = req.body;
    
    if (typeof isAvailable !== 'boolean') {
      throw new AppError('Statut de disponibilité invalide', 400);
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { isAvailable },
      { new: true, runValidators: true }
    ).select('isAvailable totalRides totalEarnings rating');

    return successResponse(res, user, `Vous êtes maintenant ${isAvailable ? 'en service' : 'hors ligne'}`);
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

module.exports = { getProfile, updateProfile, updateAvailability };