// src/middleware/errorMiddleware.js
// ALIGNEMENT DU MIDDLEWARE SECONDAIRE SUR LE STANDARD BANCAIRE
// CSCSM Level: Bank Grade

const logger = require('../config/logger');
const AppError = require('../utils/AppError');

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  let error = { ...err };
  error.message = err.message;
  error.name = err.name;
  error.code = err.code;

  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    const message = field === 'email' 
      ? 'Cet e-mail est déjà utilisé par un autre compte.' 
      : field === 'phone'
      ? 'Ce numéro de téléphone est déjà enregistré.'
      : 'Cette information est déjà utilisée.';
    error = new AppError(message, 409);
  }

  if (error.name === 'CastError') error = new AppError('Ressource introuvable.', 404);
  
  if (error.name === 'ValidationError') {
    const message = Object.values(error.errors).map(val => val.message).join('. ');
    error = new AppError(message, 400);
  }
  
  if (error.name === 'JsonWebTokenError') error = new AppError('Session invalide.', 401);
  if (error.name === 'TokenExpiredError') error = new AppError('Session expirée.', 401);

  const statusCode = error.statusCode || 500;

  if (!error.isOperational) {
    logger.error(`[CRASH] ${statusCode} - ${err.message} - ${req.originalUrl} - ${req.method}`, err);
  } else {
    logger.warn(`[API ERROR] ${statusCode} - ${error.message}`);
  }

  res.status(statusCode).json({
    success: false,
    status: error.status || 'error',
    message: error.isOperational ? error.message : 'Une erreur inattendue est survenue.',
    code: statusCode ? `ERR_${statusCode}` : 'SERVER_ERROR',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

module.exports = { errorHandler };