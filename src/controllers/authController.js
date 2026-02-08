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
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        token
      });
    } else {
      res.status(400).json({ message: "Données invalides." });
    }
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de l'inscription." });
  }
};

// @desc    Connexion flexible avec Check de Bannissement
// @route   POST /api/auth/login
const loginUser = async (req, res) => {
  const { identifier, password } = req.body; // identifier = email ou phone

  try {
    // Recherche par email OU téléphone (Insensible à la casse pour l'email)
    const user = await User.findOne({
      $or: [
        { email: { $regex: new RegExp(`^${identifier}$`, 'i') } },
        { phone: identifier }
      ]
    });

    if (user && (await user.comparePassword(password))) {
      
      // --- SÉCURITÉ DISCIPLINE : Vérification du ban ---
      if (user.isBanned) {
        return res.status(403).json({ 
          message: `Accès refusé. Raison : ${user.banReason || "Non spécifiée"}.` 
        });
      }

      const token = generateToken(res, user._id);
      res.json({
        _id: user._id,
        name: user.name,
        role: user.role,
        token
      });
    } else {
      res.status(401).json({ message: "Identifiants invalides." });
    }
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la connexion." });
  }
};

const logoutUser = (req, res) => {
  res.cookie('jwt', '', {
    httpOnly: true,
    expires: new Date(0),
  });
  res.status(200).json({ message: "Déconnecté." });
};

module.exports = { registerUser, loginUser, logoutUser };