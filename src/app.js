// src/app.js
// CONFIGURATION EXPRESS FORTERESSE - CORS strict, Sécurité NoSQL & XSS
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

// Routes
const authRoutes = require('./routes/authRoutes');
const rideRoutes = require('./routes/rideRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// Trust proxy pour Render/Heroku
if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// 1. SÉCURITÉ HEADERS (Helmet)
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

// 2. CORS STRICT
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [env.FRONTEND_URL];
    if (allowedOrigins.includes(origin) || env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      console.warn(`[CORS] Origine rejetée: ${origin}`);
      callback(new Error('Origine non autorisée par la politique CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
};

app.use(cors(corsOptions));

// 3. RATE LIMITING GLOBAL
app.use('/api/', apiLimiter);

// 4. PARSERS
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// 4.5 MIDDLEWARE DE COMPATIBILITÉ EXPRESS 5 (Fix Critical Crash)
// Rend req.query modifiable pour que mongoSanitize ne plante pas
app.use((req, res, next) => {
  Object.defineProperty(req, 'query', {
    value: { ...req.query },
    writable: true,
    configurable: true,
    enumerable: true // Assure que req.query reste visible
  });
  next();
});

// 5. NETTOYAGE ANTI-INJECTION
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    console.warn(`[SANITIZE] Champ nettoyé: ${key} - IP: ${req.ip}`);
  }
}));

// Utilisation du middleware XSS isolé
app.use(sanitizationMiddleware);

// 6. ROUTES API
// Route de santé (Health Check)
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'Yély API' });
});

app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);

// 7. GESTION ERREURS 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint non trouvé."
  });
});

// 8. GESTION GLOBALE ERREURS
app.use(errorHandler);

module.exports = app;