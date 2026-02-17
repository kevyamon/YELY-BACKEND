// src/middleware/errorMiddleware.js
// MIDDLEWARE ERREURS - Compatible AppError, Stack Traces & Robustesse Express
// CSCSM Level: Bank Grade

const logger = require('../config/logger');
const AppError = require('../utils/AppError');

const errorHandler = (err, req, res, next) => {
  // 🛡️ SÉCURITÉ EXPRESS : Si Node.js a déjà commencé à envoyer une réponse au client (ex: stream de fichier)
  // on ne tente pas de renvoyer du JSON par-dessus, sinon Express crashe (ERR_HTTP_HEADERS_SENT).
  if (res.headersSent) {
    return next(err);
  }

  let error = { ...err };
  error.message = err.message;
  error.name = err.name;

  // Transformation des erreurs Mongoose/JWT en AppError
  if (err.name === 'CastError') error = new AppError('Ressource introuvable (ID invalide)', 400);
  if (err.code === 11000) error = new AppError('Valeur dupliquée détectée (ex: Email déjà pris)', 409);
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join('. ');
    error = new AppError(message, 400);
  }
  if (err.name === 'JsonWebTokenError') error = new AppError('Token invalide', 401);
  if (err.name === 'TokenExpiredError') error = new AppError('Session expirée', 401);

  // 🚀 VISIBILITÉ : On loggue correctement
  if (!error.isOperational) {
    // FIX : On passe l'objet err complet en 2e argument pour que Winston extrait la Stack Trace !
    logger.error(`[CRASH] ${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`, err);
  } else {
    // Erreur métier prévue (ex: Mot de passe faux), log info/warn standard
    logger.warn(`[API ERROR] ${error.statusCode} - ${error.message}`);
  }

  res.status(error.statusCode || 500).json({
    success: false,
    status: error.status || 'error',
    message: error.message || 'Erreur serveur interne',
    code: error.statusCode ? `ERR_${error.statusCode}` : 'SERVER_ERROR',
    // La stack trace n'est visible par le client QU'EN environnement de développement
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

module.exports = { errorHandler };