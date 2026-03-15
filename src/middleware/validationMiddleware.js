// src/middleware/validationMiddleware.js
// MIDDLEWARE VALIDATION ZOD - Type-safe, Strict & Async-Ready
// CSCSM Level: Bank Grade

const { z } = require('zod');

/**
 * Middleware de validation Zod generique (Supporte les validations asynchrones)
 * @param {z.ZodSchema} schema - Le schema Zod a valider
 * @param {string} source - 'body' (defaut), 'query' ou 'params'
 */
const validate = (schema, source = 'body') => {
  return async (req, res, next) => {
    try {
      // Nettoyage et validation asynchrone (indispensable pour les appels reseau comme HIBP)
      const validData = await schema.parseAsync(req[source]);
      
      // On remplace les donnees brutes par les donnees validees/nettoyees
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