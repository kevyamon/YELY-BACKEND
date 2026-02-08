const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// --- 1. IMPORTATION DES ROUTES ---
const authRoutes = require('./routes/authRoutes');
const rideRoutes = require('./routes/rideRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const adminRoutes = require('./routes/adminRoutes'); // La tour de contrôle

const app = express();

// --- 2. SÉCURITÉ FORTERESSE ---
app.use(helmet());

// Limiteur de requêtes pour éviter les attaques par force brute
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requêtes max par IP
  message: "La forteresse détecte une activité suspecte. Ralentissez."
});
app.use('/api/', limiter);

// Configuration CORS pour autoriser ton futur Frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || '*', 
  credentials: true 
}));

// Analyse des données JSON avec limite de taille (Protection contre les gros fichiers malveillants)
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// --- 3. BRANCHEMENT DES ROUTES API ---
app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes); // Activation de la tour de contrôle

// --- 4. GESTION DES ERREURS (ROUTE 404) ---
app.use((req, res) => {
  res.status(404).json({ message: "Route introuvable dans cette forteresse." });
});

module.exports = app;