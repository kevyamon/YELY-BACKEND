// src/controllers/userController.js
// GESTION UTILISATEUR - Protection Mass Assignment & Whitelisting
// CSCSM Level: Bank Grade

const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/responseHandler');

/**
 * @desc    Récupérer mon profil
 * @route   GET /api/users/profile
 */
const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -__v');
    if (!user) return errorResponse(res, "Utilisateur introuvable.", 404);
    
    return successResponse(res, user, "Profil récupéré.");
  } catch (error) {
    return errorResponse(res, error.message);
  }
};

/**
 * @desc    Mettre à jour mon profil (WHITELIST STRICTE)
 * @route   PUT /api/users/profile
 */
const updateProfile = async (req, res) => {
  try {
    const { name, email, phone } = req.body; // 🔒 WHITELIST: Seuls ces champs sont extraits

    // Vérification email déjà pris (si modifié)
    if (email && email !== req.user.email) {
      const exists = await User.findOne({ email });
      if (exists) return errorResponse(res, "Cet email est déjà utilisé.", 409);
    }

    // Vérification téléphone déjà pris (si modifié)
    if (phone && phone !== req.user.phone) {
      const exists = await User.findOne({ phone });
      if (exists) return errorResponse(res, "Ce numéro est déjà utilisé.", 409);
    }

    // Mise à jour explicite champ par champ (Pas de req.body direct !)
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { 
        name: name || req.user.name,
        email: email || req.user.email,
        phone: phone || req.user.phone
      },
      { 
        new: true, 
        runValidators: true, 
        select: '-password -__v' // On ne renvoie pas de données sensibles
      }
    );

    return successResponse(res, updatedUser, "Profil mis à jour avec succès.");

  } catch (error) {
    return errorResponse(res, error.message);
  }
};

module.exports = {
  getMyProfile,
  updateProfile
};