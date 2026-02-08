const Joi = require('joi');

/**
 * Middleware générique pour valider les données entrantes via un schéma Joi
 * @param {Object} schema - Le schéma de validation Joi
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, {
      abortEarly: false, // Permet de lister TOUTES les erreurs, pas seulement la première
      errors: {
        label: 'key'
      }
    });

    if (error) {
      const errorDetails = error.details.map(detail => detail.message);
      return res.status(400).json({
        message: "Erreur de validation des données.",
        errors: errorDetails
      });
    }

    next();
  };
};

module.exports = validate;