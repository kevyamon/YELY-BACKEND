// src/middleware/requestIdMiddleware.js
// MIDDLEWARE REQUEST ID - Traçabilité complète (audit-ready)
// CSCSM Level: Bank Grade - Aucune nouvelle dépendance ajoutée

const requestIdMiddleware = (req, res, next) => {
  req.id = req.get('X-Request-ID') || `req-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  res.setHeader('X-Request-ID', req.id);
  next();
};

module.exports = requestIdMiddleware;