// src/middleware/validationMiddleware.js
// MIDDLEWARE VALIDATION ZOD - Type-safe & Strict
// CSCSM Level: Bank Grade

const { z } = require('zod');

/**
 * Middleware de validation Zod générique
 * @param {z.ZodSchema} schema - Le schéma Zod à valider
 * @param {string} source - 'body' (défaut), 'query' ou 'params'
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      // Nettoyage et validation (strip unknown keys par défaut avec Zod object)
      const validData = schema.parse(req[source]);
      
      // On remplace les données brutes par les données validées/nettoyées
      req[source] = validData;
      
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message
        }));

        return res.status(400).json({
          success: false,
          message: 'Erreur de validation.',
          errors: errorMessages
        });
      }
      
      // Erreur inattendue
      return res.status(500).json({ 
        success: false, 
        message: 'Erreur interne de validation.' 
      });
    }
  };
};

module.exports = validate;