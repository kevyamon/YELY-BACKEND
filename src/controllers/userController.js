//src/controllers/userController.js
// CONTROLEUR UTILISATEUR - Gestion Profil & Disponibilite
// CSCSM Level: Bank Grade

const User = require('../models/User');
const userService = require('../services/userService');
const { clearRefreshTokenCookie } = require('../utils/tokenService');
const { successResponse } = require('../utils/responseHandler');
const AppError = require('../utils/AppError');

const getProfile = async (req, res, next) => {
  try {
    const user = await userService.getUserProfile(req.user._id);
    return successResponse(res, user, 'Profil recupere');
  } catch (error) {
    return next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const allowedUpdates = ['name', 'phone', 'vehicle', 'hasFollowedFB'];
    const updates = Object.keys(req.body);
    const isValidOperation = updates.every(update => allowedUpdates.includes(update));

    if (!isValidOperation) throw new AppError('Mise a jour non autorisee', 400);

    const user = await userService.updateProfile(req.user._id, req.body);
    return successResponse(res, user, 'Profil mis a jour');
  } catch (error) {
    return next(error);
  }
};

const uploadProfilePicture = async (req, res, next) => {
  try {
    if (!req.file) throw new AppError("Aucune image fournie", 400);
    const user = await userService.uploadProfilePicture(req.user._id, req.file);
    return successResponse(res, { profilePicture: user.profilePicture }, 'Photo de profil mise a jour');
  } catch (error) {
    return next(error);
  }
};

const deleteAccount = async (req, res, next) => {
  try {
    await userService.anonymizeAccount(req.user._id);
    
    // Purge de la session
    clearRefreshTokenCookie(res);
    const redisClient = require('../config/redis');
    try { await redisClient.del(`auth:user:${req.user._id}`); } catch(e) {}

    return successResponse(res, null, 'Compte supprime definitivement');
  } catch (error) {
    return next(error);
  }
};

const updateAvailability = async (req, res, next) => {
  try {
    const { isAvailable } = req.body;
    
    if (typeof isAvailable !== 'boolean') {
      throw new AppError('Statut de disponibilite invalide', 400);
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { isAvailable },
      { new: true, runValidators: true }
    ).select('isAvailable totalRides totalEarnings rating');

    return successResponse(res, user, `Vous etes maintenant ${isAvailable ? 'en service' : 'hors ligne'}`);
  } catch (error) {
    return next(error);
  }
};

module.exports = { 
  getProfile, 
  updateProfile, 
  uploadProfilePicture,
  deleteAccount,
  updateAvailability 
};