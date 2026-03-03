// src/controllers/userController.js
// CONTRÔLEUR UTILISATEUR - Gestion Profil & Disponibilité
// CSCSM Level: Bank Grade

const User = require('../models/User');
const userService = require('../services/userService');
const { clearRefreshTokenCookie } = require('../utils/tokenService');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const AppError = require('../utils/AppError');

const getProfile = async (req, res) => {
  try {
    const user = await userService.getUserProfile(req.user._id);
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

    const user = await userService.updateProfile(req.user._id, req.body);
    return successResponse(res, user, 'Profil mis à jour');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const uploadProfilePicture = async (req, res) => {
  try {
    if (!req.file) throw new AppError("Aucune image fournie", 400);
    const user = await userService.uploadProfilePicture(req.user._id, req.file);
    return successResponse(res, { profilePicture: user.profilePicture }, 'Photo de profil mise à jour');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const deleteAccount = async (req, res) => {
  try {
    await userService.anonymizeAccount(req.user._id);
    
    // Purge de la session
    clearRefreshTokenCookie(res);
    const redisClient = require('../config/redis');
    try { await redisClient.del(`auth:user:${req.user._id}`); } catch(e) {}

    return successResponse(res, null, 'Compte supprimé définitivement');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

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

module.exports = { 
  getProfile, 
  updateProfile, 
  uploadProfilePicture,
  deleteAccount,
  updateAvailability 
};