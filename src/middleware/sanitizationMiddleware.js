// src/middleware/sanitizationMiddleware.js
// NETTOYAGE SÉCURITÉ - Protection XSS & Anti-DoS (O(N) Complexity)
// CSCSM Level: Bank Grade

const xss = require('xss');

/**
 * Nettoyage plat (Flat Sanitization) : On ne nettoie que le premier niveau.
 * La profondeur est gérée par la validation stricte de Zod en amont.
 * Cela évite les attaques par épuisement de CPU (ReDoS / Stack Overflow).
 */
const sanitizeFlat = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = xss(value, {
        whiteList: {}, // Aucune balise HTML autorisée
        stripIgnoreTag: true,
        stripIgnoreTagBody: ['script']
      });
    } else {
      // On conserve la structure. Zod rejettera si le type ne correspond pas.
      sanitized[key] = value;
    }
  }
  return sanitized;
};

/**
 * Middleware Express
 * Nettoie automatiquement le corps (body), les paramètres (params) et l'URL (query).
 */
const sanitizationMiddleware = (req, res, next) => {
  try {
    if (req.body) req.body = sanitizeFlat(req.body);
    if (req.params) req.params = sanitizeFlat(req.params);
    if (req.query) req.query = sanitizeFlat(req.query);
    next();
  } catch (error) {
    console.error('[XSS SANITIZE] Erreur critique:', error.message);
    return res.status(400).json({
      success: false,
      message: "Structure de données invalide."
    });
  }
};

module.exports = { sanitizationMiddleware };