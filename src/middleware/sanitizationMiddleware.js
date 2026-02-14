// src/middleware/sanitizationMiddleware.js
// NETTOYAGE SÉCURITÉ - Protection contre les injections XSS
// CSCSM Level: Bank Grade

const xss = require('xss');

/**
 * Fonction récursive pour nettoyer les objets des scripts malveillants
 */
const sanitizeXSS = (obj) => {
  if (typeof obj === 'string') {
    return xss(obj, {
      whiteList: {},
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script']
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeXSS);
  }
  if (obj !== null && typeof obj === 'object') {
    const sanitized = {};
    for (const key of Object.keys(obj)) {
      // Protection contre la pollution de prototype
      if (key === '__proto__' || key === 'constructor') continue;
      sanitized[key] = sanitizeXSS(obj[key]);
    }
    return sanitized;
  }
  return obj;
};

/**
 * Middleware qui nettoie Body, Params et Query
 */
const sanitizationMiddleware = (req, res, next) => {
  try {
    if (req.body) req.body = sanitizeXSS(req.body);
    if (req.params) req.params = sanitizeXSS(req.params);
    if (req.query) req.query = sanitizeXSS(req.query);
    next();
  } catch (error) {
    console.error('[XSS SANITIZE] Erreur:', error.message);
    return res.status(400).json({
      success: false,
      message: "Données de requête invalides."
    });
  }
};

module.exports = { sanitizationMiddleware };