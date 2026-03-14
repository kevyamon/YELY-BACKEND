// src/middleware/sanitizationMiddleware.js
// NETTOYAGE SÉCURITÉ - Protection XSS Profonde & Anti-DoS
// CSCSM Level: Bank Grade

const xss = require('xss');

const MAX_DEPTH = 4;

const sanitizeDeep = (obj, depth = 0) => {
  if (depth > MAX_DEPTH) return obj;
  if (!obj || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => {
      if (typeof item === 'string') {
        return xss(item, {
          whiteList: {}, 
          stripIgnoreTag: true,
          stripIgnoreTagBody: ['script']
        });
      } else if (typeof item === 'object' && item !== null) {
        return sanitizeDeep(item, depth + 1);
      }
      return item;
    });
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = xss(value, {
        whiteList: {}, 
        stripIgnoreTag: true,
        stripIgnoreTagBody: ['script']
      });
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeDeep(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

const sanitizationMiddleware = (req, res, next) => {
  try {
    if (req.body) req.body = sanitizeDeep(req.body);
    if (req.params) req.params = sanitizeDeep(req.params);
    if (req.query) req.query = sanitizeDeep(req.query);
    next();
  } catch (error) {
    console.error('[XSS SANITIZE] Erreur critique:', error.message);
    return res.status(400).json({
      success: false,
      message: "Structure de donnees invalide."
    });
  }
};

module.exports = { sanitizationMiddleware };