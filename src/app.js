const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const { filterXSS } = require('xss'); // Nouveau moteur XSS Pro
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
// Application manuelle pour compatibilité Express 5
app.use((req, res, next) => {
  if (req.body) {
    // Nettoyage NoSQL
    req.body = mongoSanitize.sanitize(req.body);
    
    // Nettoyage XSS Pro (On transforme le JSON en string, on nettoie, on repasse en JSON)
    let stringifiedBody = JSON.stringify(req.body);
    stringifiedBody = filterXSS(stringifiedBody);
    req.body = JSON.parse(stringifiedBody);
  }
  
  if (req.params) {
    req.params = mongoSanitize.sanitize(req.params);
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