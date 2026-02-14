// src/utils/responseHandler.js
// STANDARDISATION DES RÉPONSES API (JSend Strict)
// CSCSM Level: Bank Grade

/**
 * Envoie une réponse de succès standardisée
 * @param {Object} res - L'objet réponse Express
 * @param {Object} data - Les données à renvoyer (payload)
 * @param {String} message - Message utilisateur
 * @param {Number} statusCode - Code HTTP (200, 201...)
 */
const successResponse = (res, data, message = 'Opération réussie', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data // C'est ICI que le Frontend attend les données
  });
};

/**
 * Envoie une réponse d'erreur standardisée
 * @param {Object} res - L'objet réponse Express
 * @param {String} message - Message d'erreur utilisateur
 * @param {Number} statusCode - Code HTTP (400, 401, 500...)
 * @param {Object} error - L'objet erreur technique (pour logs)
 */
const errorResponse = (res, message = 'Erreur serveur', statusCode = 500, error = null) => {
  if (error && process.env.NODE_ENV === 'development') {
    console.error(`[ERROR] ${message}:`, error);
  }
  
  return res.status(statusCode).json({
    success: false,
    message,
    code: error?.code || 'SERVER_ERROR',
    ...(process.env.NODE_ENV === 'development' && { stack: error?.stack })
  });
};

module.exports = {
  successResponse,
  errorResponse
};