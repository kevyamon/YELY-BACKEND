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

  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    const message = field === 'email' 
      ? 'Cette adresse e-mail est deja associee a un compte.' 
      : field === 'phone'
      ? 'Ce numero de telephone est deja enregistre.'
      : 'Cet identifiant existe deja dans notre systeme.';
    error = new AppError(message, 409);
  }

  if (error.name === 'CastError') {
    error = new AppError('Ressource introuvable ou invalide.', 404);
  }

  if (error.name === 'ValidationError') {
    // NETTOYAGE PROD: On masque les erreurs systemes brutes
    error = new AppError('Certaines donnees fournies sont invalides. Veuillez verifier votre saisie.', 400);
  }

  if (error.name === 'JsonWebTokenError') {
    error = new AppError('Session invalide. Veuillez vous reconnecter.', 401);
  }
  
  if (error.name === 'TokenExpiredError') {
    error = new AppError('Session expiree. Veuillez vous reconnecter.', 401);
  }

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

  res.status(statusCode).json({
    success: false,
    status: error.status || 'error',
    message: error.isOperational 
      ? error.message 
      : 'Une erreur interne est survenue. Notre equipe technique a ete notifiee.',
    requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;