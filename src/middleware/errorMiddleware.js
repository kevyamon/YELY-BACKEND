// src/middleware/errorMiddleware.js
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  let error = { ...err };
  error.message = err.message;
  error.name = err.name;

  // Transformation des erreurs courantes
  if (err.name === 'CastError') error = new AppError('Ressource introuvable (ID invalide)', 400);
  if (err.code === 11000) error = new AppError('Cette valeur existe déjà (Email ou téléphone)', 409);
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join('. ');
    error = new AppError(message, 400);
  }
  if (err.name === 'JsonWebTokenError') error = new AppError('Token invalide', 401);
  if (err.name === 'TokenExpiredError') error = new AppError('Session expirée', 401);

  if (!error.isOperational) {
    logger.error(`[CRASH] ${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`, err);
  } else {
    logger.warn(`[API ERROR] ${error.statusCode} - ${error.message}`);
  }

  res.status(error.statusCode || 500).json({
    success: false,
    status: error.status || 'error',
    message: error.message || 'Erreur serveur interne',
    code: error.statusCode ? `ERR_${error.statusCode}` : 'SERVER_ERROR',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

module.exports = { errorHandler };