const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;
  token = req.cookies.jwt;

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.userId).select('-password');
      next();
    } catch (error) {
      res.status(401).json({ message: "Non autorisé, token invalide." });
    }
  } else {
    res.status(401).json({ message: "Non autorisé, aucun token." });
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