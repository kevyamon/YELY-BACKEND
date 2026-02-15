// src/middleware/sanitizationMiddleware.js
// NETTOYAGE SÉCURITÉ - Protection XSS & Anti-DoS
// CSCSM Level: Bank Grade

const xss = require('xss');

/**
 * Nettoie les chaînes de caractères des scripts malveillants.
 * Comporte une sécurité anti-récursion (Max 10 niveaux).
 */
const sanitizeXSS = (obj, depth = 0) => {
  // 1. PROTECTION ANTI-DOS (Stack Overflow)
  // Si l'objet est trop profond (plus de 10 sous-dossiers), on arrête pour éviter le crash.
  if (depth > 10) {
    return null; 
  }

  // 2. Si c'est du texte, on nettoie
  if (typeof obj === 'string') {
    return xss(obj, {
      whiteList: {}, // Aucune balise HTML n'est autorisée
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script'] // On supprime le contenu des scripts
    });
  }

  // 3. Si c'est un tableau, on nettoie chaque élément
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeXSS(item, depth + 1));
  }

  // 4. Si c'est un objet JSON, on nettoie chaque clé
  if (obj !== null && typeof obj === 'object') {
    const sanitized = {};
    for (const key of Object.keys(obj)) {
      // Protection contre la pollution de prototype (Attaque classique JS)
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      
      sanitized[key] = sanitizeXSS(obj[key], depth + 1);
    }
    return sanitized;
  }

  // 5. Sinon (nombre, boolean...), on retourne tel quel
  return obj;
};

/**
 * Middleware Express
 * Nettoie automatiquement le corps (body), les paramètres (params) et l'URL (query).
 */
const sanitizationMiddleware = (req, res, next) => {
  try {
    if (req.body) req.body = sanitizeXSS(req.body);
    if (req.params) req.params = sanitizeXSS(req.params);
    if (req.query) req.query = sanitizeXSS(req.query);
    next();
  } catch (error) {
    console.error('[XSS SANITIZE] Erreur critique:', error.message);
    return res.status(400).json({
      success: false,
      message: "Structure de données invalide ou trop complexe."
    });
  }
};

module.exports = { sanitizationMiddleware };