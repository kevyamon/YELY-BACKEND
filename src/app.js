// src/app.js
// CONFIGURATION EXPRESS FORTERESSE - CORS strict, Sécurité NoSQL & XSS & Monitoring
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

// 📊 CONFIGURATION MONITORING (Tableau de bord temps réel)
const statusMonitor = require('express-status-monitor')({
  title: 'Yély Monitor',
  path: '/status',
  socketPath: '/socket.io', // On surveille aussi les WebSockets
  chartVisibility: {
    cpu: true,
    mem: true,
    load: true,
    responseTime: true,
    rps: true,
    statusCodes: true,
  },
  healthChecks: [{
    protocol: 'http',
    host: 'localhost',
    path: '/',
    port: process.env.PORT || 5000
  }]
});

// Routes
const authRoutes = require('./routes/authRoutes');
const rideRoutes = require('./routes/rideRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

// Trust proxy pour Render/Heroku (Important pour Rate Limit)
if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// 0. MONITORING (DOIT ÊTRE LE PREMIER) 🛑
// Accessible sur /status
app.use(statusMonitor);

// 1. LOGS HTTP
app.use((req, res, next) => {
  logger.http(`${req.method} ${req.url} - IP: ${req.ip}`);
  next();
});

// 2. SÉCURITÉ HEADERS (Helmet)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Nécessaire pour le CSS de status-monitor
      scriptSrc: ["'self'", "'unsafe-inline'"], // Nécessaire pour les charts de status-monitor
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

// 5. PARSERS
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// 6. NETTOYAGE ANTI-INJECTION
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    logger.warn(`[SANITIZE] Champ nettoyé: ${key} - IP: ${req.ip}`);
  }
}));

// Utilisation du middleware XSS isolé
app.use(sanitizationMiddleware);

// 7. ROUTES API
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'Yély API' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);

// 8. GESTION ERREURS 404
app.use((req, res) => {
  logger.warn(`[404] Endpoint non trouvé: ${req.method} ${req.url}`);
  res.status(404).json({
    success: false,
    message: "Endpoint non trouvé."
  });
});

// 9. GESTION GLOBALE ERREURS
app.use(errorHandler);

module.exports = app;