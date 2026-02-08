// backend/middleware/authMiddleware.js

const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  // 1. Chercher le token dans le header Authorization (Bearer)
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // 2. Fallback : chercher dans les cookies
  if (!token && req.cookies && req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return res.status(401).json({ message: "Non autorisé, aucun token." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.userId).select('-password');

    if (!req.user) {
      return res.status(401).json({ message: "Utilisateur introuvable." });
    }

    // Vérifier si l'utilisateur est banni
    if (req.user.isBanned) {
      return res.status(403).json({
        message: `Accès refusé. Raison : ${req.user.banReason || "Non spécifiée"}.`
      });
    }

    next();
  } catch (error) {
    console.error("❌ [AUTH] Token invalide :", error.message);
    res.status(401).json({ message: "Non autorisé, token invalide." });
  }
};

// Middleware pour restreindre l'accès par rôle
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Le rôle ${req.user.role} n'est pas autorisé à accéder à cette ressource.`
      });
    }
    next();
  };
};

module.exports = { protect, authorize };