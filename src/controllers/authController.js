// backend/controllers/authController.js

const User = require('../models/User');
const generateToken = require('../utils/generateToken');

// @desc    Inscription
// @route   POST /api/auth/register
const registerUser = async (req, res) => {
  const { name, email, phone, password, role } = req.body;

  try {
    const userExists = await User.findOne({ $or: [{ email }, { phone }] });

    if (userExists) {
      return res.status(400).json({ message: "L'utilisateur existe déjà (Email ou Tel)." });
    }

    // Attribution automatique du rôle SuperAdmin si c'est ton mail
    let finalRole = role || 'rider';
    if (email === process.env.ADMIN_MAIL) {
      finalRole = 'superadmin';
    }

    const user = await User.create({
      name,
      email,
      phone,
      password,
      role: finalRole
    });

    if (user) {
      const token = generateToken(res, user._id);
      res.status(201).json({
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
        },
        token
      });
    } else {
      res.status(400).json({ message: "Données invalides." });
    }
  } catch (error) {
    console.error("❌ [REGISTER] Erreur serveur :", error.message, error.stack);
    res.status(500).json({ message: "Erreur lors de l'inscription." });
  }
};

// @desc    Connexion flexible avec Check de Bannissement
// @route   POST /api/auth/login
const loginUser = async (req, res) => {
  const { identifier, password } = req.body;

  try {
    const user = await User.findOne({
      $or: [
        { email: { $regex: new RegExp(`^${identifier}$`, 'i') } },
        { phone: identifier }
      ]
    });

    if (user && (await user.comparePassword(password))) {

      if (user.isBanned) {
        return res.status(403).json({
          message: `Accès refusé. Raison : ${user.banReason || "Non spécifiée"}.`
        });
      }

      const token = generateToken(res, user._id);
      res.json({
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
        },
        token
      });
    } else {
      res.status(401).json({ message: "Identifiants invalides." });
    }
  } catch (error) {
    console.error("❌ [LOGIN] Erreur serveur :", error.message, error.stack);
    res.status(500).json({ message: "Erreur lors de la connexion." });
  }
};

// @desc    Déconnexion
// @route   POST /api/auth/logout
const logoutUser = (req, res) => {
  res.cookie('jwt', '', {
    httpOnly: true,
    expires: new Date(0),
  });
  res.status(200).json({ message: "Déconnecté." });
};

// @desc    Toggle disponibilité chauffeur
// @route   PUT /api/auth/availability
const updateAvailability = async (req, res) => {
  const { isAvailable } = req.body;

  try {
    // Vérifier que c'est bien un chauffeur
    if (req.user.role !== 'driver') {
      return res.status(403).json({
        message: "Seuls les chauffeurs peuvent modifier leur disponibilité."
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { isAvailable: Boolean(isAvailable) },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable." });
    }

    res.json({
      _id: user._id,
      isAvailable: user.isAvailable,
      message: user.isAvailable
        ? "Vous êtes maintenant disponible pour recevoir des courses."
        : "Vous êtes hors ligne. Aucune course ne vous sera proposée."
    });
  } catch (error) {
    console.error("❌ [AVAILABILITY] Erreur serveur :", error.message, error.stack);
    res.status(500).json({ message: "Erreur lors de la mise à jour de la disponibilité." });
  }
};

module.exports = { registerUser, loginUser, logoutUser, updateAvailability };