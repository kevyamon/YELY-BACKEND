// backend/app.js

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss');
require('dotenv').config();

// Imports des routes
const authRoutes = require('./routes/authRoutes');
const rideRoutes = require('./routes/rideRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// --- 1. SÉCURITÉ RÉSEAU (HELMET & RATE LIMIT) ---
app.use(helmet());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "La forteresse détecte une activité suspecte. Ralentissez."
});
app.use('/api/', limiter);

// --- 2. ANALYSEURS DE DONNÉES (PARSERS) ---
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// --- 3. NETTOYAGE DES DONNÉES (ANTI-INJECTION NOSQL & XSS) ---

// Fonction récursive pour nettoyer toutes les chaînes d'un objet
const sanitizeXSS = (obj) => {
  if (typeof obj === 'string') {
    return xss(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeXSS);
  }
  if (obj !== null && typeof obj === 'object') {
    const sanitized = {};
    for (const key of Object.keys(obj)) {
      sanitized[key] = sanitizeXSS(obj[key]);
    }
    return sanitized;
  }
  return obj;
};

app.use((req, res, next) => {
  try {
    if (req.body && typeof req.body === 'object') {
      // Nettoyage NoSQL (anti $gt, $ne, etc.)
      req.body = mongoSanitize.sanitize(req.body);
      // Nettoyage XSS propre (champ par champ, sans stringify/parse)
      req.body = sanitizeXSS(req.body);
    }

    if (req.params && typeof req.params === 'object') {
      req.params = mongoSanitize.sanitize(req.params);
    }

    if (req.query && typeof req.query === 'object') {
      req.query = mongoSanitize.sanitize(req.query);
      req.query = sanitizeXSS(req.query);
    }
  } catch (error) {
    console.error("Erreur lors du nettoyage des données :", error);
    return res.status(400).json({ message: "Données de requête invalides." });
  }

  next();
});

// --- 4. CONFIGURATION DES ACCÈS (CORS) ---
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

// --- 5. BRANCHEMENT DES ROUTES API ---
app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);

// --- 6. GESTION DES ERREURS 404 ---
app.use((req, res) => {
  res.status(404).json({ message: "Route introuvable dans cette forteresse." });
});

module.exports = app;