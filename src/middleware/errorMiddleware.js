// src/middleware/errorMiddleware.js
// MIDDLEWARE ERREURS - Compatible AppError
// CSCSM Level: Bank Grade

const logger = require('../config/logger');
const AppError = require('../utils/AppError');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Si c'est une erreur inconnue, on loggue fort
  if (!err.isOperational) {
    logger.error(`[CRASH] ${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
    if (process.env.NODE_ENV === 'development') logger.debug(err.stack);
  } else {
    // Erreur métier prévue (ex: Mot de passe faux), log info/warn
    logger.warn(`[API ERROR] ${err.statusCode} - ${err.message}`);
  }

  // Transformation des erreurs Mongoose/JWT en AppError
  if (err.name === 'CastError') error = new AppError('Ressource introuvable (ID invalide)', 400);
  if (err.code === 11000) error = new AppError('Valeur dupliquée détectée (ex: Email déjà pris)', 409);
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join('. ');
    error = new AppError(message, 400);
  }
  if (err.name === 'JsonWebTokenError') error = new AppError('Token invalide', 401);
  if (err.name === 'TokenExpiredError') error = new AppError('Session expirée', 401);

  res.status(error.statusCode || 500).json({
    success: false,
    status: error.status || 'error',
    message: error.message || 'Erreur serveur interne',
    code: error.statusCode ? `ERR_${error.statusCode}` : 'SERVER_ERROR',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

module.exports = { errorHandler };