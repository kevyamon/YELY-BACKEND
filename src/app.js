// src/app.js
// CONFIGURATION EXPRESS FORTERESSE - Versioning API & Sécurité Flux
// CSCSM Level: Bank Grade

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const { env } = require('./config/env');
const { apiLimiter } = require('./middleware/rateLimitMiddleware');
const { sanitizationMiddleware } = require('./middleware/sanitizationMiddleware');
const { errorHandler } = require('./middleware/errorMiddleware');
const logger = require('./config/logger');

// Routes
const authRoutes = require('./routes/authRoutes');
const rideRoutes = require('./routes/rideRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

// Trust proxy pour Render/Heroku (Précision pour le Rate Limiting)
if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// 1. LOGS HTTP (Utilise le logger avec masquage PII)
app.use((req, res, next) => {
  logger.http(`${req.method} ${req.url} - IP: ${req.ip}`);
  next();
});

// 2. SÉCURITÉ HEADERS (Helmet avec CSP stricte)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
      connectSrc: ["'self'", env.FRONTEND_URL],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// 3. CORS STRICT
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [env.FRONTEND_URL];
    if (allowedOrigins.includes(origin) || env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      logger.warn(`[CORS] Origine rejetée: ${origin}`);
      callback(new Error('Origine non autorisée par la politique CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
};

app.use(cors(corsOptions));

// 4. RATE LIMITING GLOBAL
app.use('/api/', apiLimiter);

// 5. PARSERS & PROTECTION PAYLOAD
app.use(express.json({ limit: '10kb' })); // Protection contre les payloads massifs
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// 6. NETTOYAGE ANTI-INJECTION
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    logger.warn(`[SANITIZE] Champ suspect nettoyé: ${key} - IP: ${req.ip}`);
  }
}));

// Protection XSS (Middleware isolé)
app.use(sanitizationMiddleware);

// 7. ROUTES API - VERSIONING V1 (Bank Grade)
const API_V1_PREFIX = '/api/v1';

// Health Check Simple
app.get('/status', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date(),
    uptime: process.uptime(),
    env: env.NODE_ENV,
    version: '1.0.0',
    service: 'Yély API'
  });
});

app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'Yély API Ready' });
});

// Montage des modules sous le préfixe V1
app.use(`${API_V1_PREFIX}/auth`, authRoutes);
app.use(`${API_V1_PREFIX}/users`, userRoutes);
app.use(`${API_V1_PREFIX}/rides`, rideRoutes);
app.use(`${API_V1_PREFIX}/subscriptions`, subscriptionRoutes);
app.use(`${API_V1_PREFIX}/admin`, adminRoutes);

// 8. GESTION DES ROUTES INEXISTANTES (404)
app.use((req, res) => {
  logger.warn(`[404] Endpoint non trouvé ou accès non autorisé: ${req.method} ${req.url}`);
  res.status(404).json({
    success: false,
    message: "La ressource demandée est introuvable."
  });
});

// 9. GESTIONNAIRE D'ERREURS CENTRALISÉ
app.use(errorHandler);

module.exports = app;