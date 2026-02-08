const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
require('dotenv').config();

// Imports des routes
const authRoutes = require('./routes/authRoutes');
const rideRoutes = require('./routes/rideRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// --- SÉCURITÉ FORTERESSE (ORDRE CRITIQUE) ---

// 1. Headers de sécurité de base
app.use(helmet());

// 2. Limiteur de débit (Anti-DDoS / Brute Force)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: "La forteresse détecte une activité suspecte. Ralentissez."
});
app.use('/api/', limiter);

// 3. Nettoyage contre les injections NoSQL
app.use(mongoSanitize());

// 4. Nettoyage contre les failles XSS
app.use(xss());

// 5. Configuration CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || '*', 
  credentials: true 
}));

// 6. Analyseurs de données avec limites
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// --- ROUTES API ---
app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);

// --- GESTION DES ERREURS 404 ---
app.use((req, res) => {
  res.status(404).json({ message: "Route introuvable dans cette forteresse." });
});

module.exports = app;