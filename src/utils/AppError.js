// src/utils/AppError.js
// GESTION ERREURS STANDARDISÉE
// CSCSM Level: Bank Grade

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true; // Permet de distinguer les erreurs prévues des bugs
    
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;