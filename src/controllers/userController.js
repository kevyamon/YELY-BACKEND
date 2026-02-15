// src/controllers/userController.js
// ORCHESTRATION UTILISATEUR
// CSCSM Level: Bank Grade

const userService = require('../services/userService');
const { successResponse, errorResponse } = require('../utils/responseHandler');

const getMyProfile = async (req, res) => {
  try {
    const user = await userService.getUserProfile(req.user._id);
    return successResponse(res, user, "Profil récupéré.");
  } catch (error) {
    return errorResponse(res, error.message, error.status || 500);
  }
};

const updateProfile = async (req, res) => {
  try {
    const updatedUser = await userService.updateProfile(req.user._id, req.body);
    return successResponse(res, updatedUser, "Profil mis à jour avec succès.");
  } catch (error) {
    return errorResponse(res, error.message, error.status || 500);
  }
};

module.exports = { getMyProfile, updateProfile };