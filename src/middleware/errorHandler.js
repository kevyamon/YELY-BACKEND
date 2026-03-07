// src/middleware/errorHandler.js
// MIDDLEWARE CENTRALISE DE GESTION D'ERREURS - Traduction Humaine & Securite
// CSCSM Level: Bank Grade

const Sentry = require('@sentry/node');
const logger = require('../config/logger');
const CONSTANTS = require('../utils/constants');
const AppError = require('../utils/AppError');
const { env } = require('../config/env');
const emailService = require('../utils/emailService');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.name = err.name;
  error.code = err.code;

  const requestId = req.id || `req-${Date.now()}`;
  error.requestId = requestId;

  // Humanisation des erreurs de duplication MongoDB
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    const message = field === 'email' 
      ? 'Un compte existe deja avec cette adresse e-mail. Veuillez vous connecter.' 
      : field === 'phone'
      ? 'Ce numero de telephone est deja associe a un autre compte.'
      : 'Ces informations sont deja utilisees dans notre systeme.';
    error = new AppError(message, 409);
    error.isOperational = true;
  }

  if (error.name === 'CastError') {
    error = new AppError('Ressource introuvable ou invalide.', 404);
    error.isOperational = true;
  }

  if (error.name === 'ValidationError') {
    error = new AppError('Certaines donnees fournies sont invalides. Veuillez verifier votre saisie.', 400);
    error.isOperational = true;
  }

  if (error.name === 'JsonWebTokenError') {
    error = new AppError('Votre session est invalide. Veuillez vous reconnecter.', 401);
    error.isOperational = true;
  }
  
  if (error.name === 'TokenExpiredError') {
    error = new AppError('Votre session a expire. Veuillez vous reconnecter.', 401);
    error.isOperational = true;
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

  // DETECTION DES DEPASSEMENTS DE QUOTAS (Services Externes)
  const errorMsgStr = error.message ? error.message.toLowerCase() : '';
  const isQuotaError = 
    errorMsgStr.includes('quota') || 
    errorMsgStr.includes('rate limit') || 
    errorMsgStr.includes('too many requests') || 
    errorMsgStr.includes('max memory') || 
    error.name === 'MongoTimeoutError';

  if (isQuotaError && env.NODE_ENV === 'production') {
    logger.error(`[ALERTE QUOTA] Un service externe atteint ses limites !`, { message: error.message });
    
    try {
      emailService.sendAdminAlert(
        `Limite de Quota Atteinte`, 
        `Une erreur liee aux quotas a ete detectee en production.\n\nErreur : ${error.message}\nRoute : ${req.originalUrl}\nRequest ID : ${requestId}`
      );
    } catch (mailErr) {
      logger.error(`[ALERTE QUOTA] Echec de l'envoi de l'email d'alerte`, mailErr);
    }
  }

  // Envoi silencieux a Sentry des erreurs critiques (non operationnelles ou plantage serveur)
  if (env.SENTRY_DSN && (!error.isOperational || statusCode >= 500)) {
    Sentry.captureException(err, {
      tags: { requestId, route: req.originalUrl },
      extra: { body: req.body, method: req.method }
    });
  }

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
      : 'Une erreur interne est survenue. Notre equipe technique a ete automatiquement notifiee.',
    requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;