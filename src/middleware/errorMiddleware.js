// src/middleware/errorMiddleware.js
// GESTIONNAIRE D'ERREURS CENTRALISÉ - Standardisation des réponses d'échec
// CSCSM Level: Bank Grade

/**
 * Capture toutes les erreurs et renvoie un format JSON uniforme
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log de l'erreur pour le développeur (console)
  console.error(`❌ [ERROR] ${req.method} ${req.originalUrl} :`, err.stack);

  // 1. Erreur de validation Mongoose (ex: email invalide)
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message);
    error = new Error(message.join(', '));
    error.status = 400;
  }

  // 2. Erreur d'ID Mongoose mal formé
  if (err.name === 'CastError') {
    error = new Error("Ressource introuvable.");
    error.status = 404;
  }

  // 3. Erreur de duplication (ex: email déjà pris)
  if (err.code === 11000) {
    error = new Error("Cette donnée existe déjà dans notre base.");
    error.status = 409;
  }

  // Réponse finale standardisée
  res.status(error.status || 500).json({
    success: false,
    message: error.message || "Une erreur interne est survenue.",
    code: error.code || 'SERVER_ERROR',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

module.exports = { errorHandler };