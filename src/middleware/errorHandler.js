// src/middleware/errorHandler.js
// MIDDLEWARE CENTRALISÉ DE GESTION D'ERREURS - Correlation ID + Winston + Sécurité
// CSCSM Level: Bank Grade

const logger = require('../config/logger');
const CONSTANTS = require('../utils/constants');
const AppError = require('../utils/AppError');

const errorHandler = (err, req, res, next) => {
  const requestId = req.id || `req-${Date.now()}`;
  
  // Ajout du requestId pour traçabilité complète dans les logs
  err.requestId = requestId;

  // Logging structuré (jamais de stack trace en prod)
  const logData = {
    requestId,
    method: req.method,
    url: req.originalUrl,
    statusCode: err.statusCode || CONSTANTS.HTTP_STATUS.INTERNAL_SERVER_ERROR,
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  };

  if (err.isOperational) {
    logger.warn(`[OPERATIONAL ERROR ${requestId}]`, logData);
  } else {
    logger.error(`[CRITICAL ERROR ${requestId}]`, logData);
  }

  // Réponse client sécurisée (jamais de détails sensibles en prod)
  res.status(err.statusCode || CONSTANTS.HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    status: err.status || 'error',
    message: err.isOperational 
      ? err.message 
      : 'Une erreur interne est survenue. Notre équipe a été notifiée.',
    requestId, // utile pour le support
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;