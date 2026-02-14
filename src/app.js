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

// Trust proxy pour Render/Heroku (Important pour le rate limiting et https)
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

// 2. CORS STRICT - Adapté pour Mobile & Web
const corsOptions = {
  origin: (origin, callback) => {
    // Autoriser les requêtes sans origine (Mobile Apps, Curl, Postman, Render Health Checks)
    if (!origin) {
      return callback(null, true);
    }
    
    // Pour les navigateurs Web, on vérifie strictement la liste blanche
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

// 4. PARSERS (limites strictes)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

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
// Route de santé pour Render (pour éviter les erreurs 404 dans les logs)
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