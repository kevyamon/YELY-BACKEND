// src/app.js
// CONFIGURATION EXPRESS FORTERESSE - Versioning API & Sécurité Flux
// CSCSM Level: Bank Grade

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const hpp = require('hpp'); // Protection contre la pollution des paramètres
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

// 0. DURCISSEMENT SERVEUR
app.disable('x-powered-by'); // Cache la techno utilisée (même si helmet le fait, la redondance est reine)

// Trust proxy pour Render/Heroku
if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// 1. LOGS HTTP
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
app.use(express.json({ limit: '10kb' })); 
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// 6. NETTOYAGE & PROTECTION PARAMÈTRES
app.use(hpp()); // Bloque les attaques de type ?id=1&id=2
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    logger.warn(`[SANITIZE] Champ suspect nettoyé: ${key} - IP: ${req.ip}`);
  }
}));
app.use(sanitizationMiddleware);

// 7. ROUTES API - VERSIONING V1
const API_V1_PREFIX = '/api/v1';

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

app.use(`${API_V1_PREFIX}/auth`, authRoutes);
app.use(`${API_V1_PREFIX}/users`, userRoutes);
app.use(`${API_V1_PREFIX}/rides`, rideRoutes);
app.use(`${API_V1_PREFIX}/subscriptions`, subscriptionRoutes);
app.use(`${API_V1_PREFIX}/admin`, adminRoutes);

app.use((req, res) => {
  logger.warn(`[404] Endpoint non trouvé: ${req.method} ${req.url}`);
  res.status(404).json({ success: false, message: "La ressource demandée est introuvable." });
});

app.use(errorHandler);

module.exports = app;