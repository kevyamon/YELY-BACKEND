// src/utils/AppError.js
// CLASSE ERREUR OPÉRATIONNELLE YÉLY - Pour gestion propre des erreurs attendues
// CSCSM Level: Bank Grade

class AppError extends Error {
  constructor(message, statusCode, isOperational = true) {
    super(message);

    this.statusCode = statusCode;
    this.isOperational = isOperational; // true = erreur métier, false = bug système
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.timestamp = new Date().toISOString();

    // Stack trace propre
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;