// src/middleware/errorHandler.js
// MIDDLEWARE CENTRALISE DE GESTION D'ERREURS - Traduction Humaine & Securite
// CSCSM Level: Bank Grade

const logger = require('../config/logger');
const CONSTANTS = require('../utils/constants');
const AppError = require('../utils/AppError');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.name = err.name;
  error.code = err.code;

  const requestId = req.id || `req-${Date.now()}`;
  error.requestId = requestId;

  // TRADUCTION DES ERREURS SYSTEMES EN MESSAGES UTILISATEURS PROPRES

  // 1. Erreur de duplication de base de donnees (ex: compte existant)
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    const message = field === 'email' 
      ? 'Cet email est deja utilise par un autre compte.' 
      : field === 'phone'
      ? 'Ce numero de telephone est deja enregistre.'
      : 'Cet identifiant existe deja dans notre systeme.';
    error = new AppError(message, 409);
  }

  // 2. Ressource introuvable (ID mal formatte)
  if (error.name === 'CastError') {
    error = new AppError('Ressource introuvable ou invalide.', 404);
  }

  // 3. Echec de validation du schema Mongoose
  if (error.name === 'ValidationError') {
    const message = Object.values(error.errors).map(val => val.message).join('. ');
    error = new AppError(message, 400);
  }

  // 4. Securite des tokens (JWT)
  if (error.name === 'JsonWebTokenError') {
    error = new AppError('Session invalide. Veuillez vous reconnecter.', 401);
  }
  if (error.name === 'TokenExpiredError') {
    error = new AppError('Session expiree. Veuillez vous reconnecter.', 401);
  }

  // Logging structure en arriere-plan
  const statusCode = error.statusCode || CONSTANTS.HTTP_STATUS?.INTERNAL_SERVER_ERROR || 500;
  
  const logData = {
    requestId,
    method: req.method,
    url: req.originalUrl,
    statusCode,
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  };

  if (error.isOperational) {
    logger.warn(`[OPERATIONAL ERROR ${requestId}]`, logData);
  } else {
    logger.error(`[CRITICAL ERROR ${requestId}]`, logData);
  }

  // Reponse envoyee au front (Toasts)
  res.status(statusCode).json({
    success: false,
    status: error.status || 'error',
    message: error.isOperational 
      ? error.message 
      : 'Une erreur interne est survenue. Notre equipe a ete notifiee.',
    requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;