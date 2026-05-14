// src/app.js
// CONFIGURATION EXPRESS FORTERESSE - Versioning API & Sécurité Flux
// CSCSM Level: Bank Grade

const express = require('express');
const Sentry = require('@sentry/node');
const helmet = require('helmet');
const cors = require('cors');
const hpp = require('hpp');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const { env } = require('./config/env');
const { apiLimiter } = require('./middleware/rateLimitMiddleware');
const { sanitizationMiddleware } = require('./middleware/sanitizationMiddleware');
const errorHandler = require('./middleware/errorHandler');
const requestIdMiddleware = require('./middleware/requestIdMiddleware'); 
const logger = require('./config/logger');

// ==========================================
// IMPORTATION STRICTE DES ROUTES
// ==========================================
const authRoutes = require('./routes/authRoutes');
const rideRoutes = require('./routes/rideRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const healthRoutes = require('./routes/healthRoutes');
const poiRoutes = require('./routes/poiRoutes');
const agentRoutes = require('./routes/agentRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const reportRoutes = require('./routes/reportRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const ledgerRoutes = require('./routes/ledgerRoutes');

// Extraction des origines autorisées en tableau
const allowedOriginsList = env.ALLOWED_ORIGINS.split(',').map(url => url.trim());

// Initialisation de Sentry au tout début pour capter les erreurs globales
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.2 : 1.0,
  });
  logger.info('[SENTRY] Monitoring des erreurs active.');
}

const app = express();

// helmet() le fait déjà plus bas, mais une sécurité redondante n'est pas un problème ici
app.disable('x-powered-by');

// Trust Proxy activé globalement pour garantir l'identification IP correcte 
// derrière Cloudflare/Nginx en dev/staging/prod pour le Rate Limiting.
app.set('trust proxy', 1);

app.use(requestIdMiddleware);

app.use((req, res, next) => {
  logger.http(`${req.method} ${req.url} - IP: ${req.ip} - RequestID: ${req.id}`);
  next();
});

// ==========================================
// CONFIGURATION CORS
// ==========================================
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    
    if (allowedOriginsList.includes(origin) || env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      logger.warn(`[CORS] Origine rejetée: ${origin}`);
      callback(new Error('Origine non autorisee par la politique CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With', 
    'Accept', 
    'x-content-type-options', 
    'Origin', 
    'X-Request-ID'
  ],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Assouplissement ciblé du CSP pour les images
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com", "https://*.cloudinary.com"],
      connectSrc: ["'self'", ...allowedOriginsList],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Application du limiteur de requêtes sur les routes API
app.use('/api/', apiLimiter);

// Parseurs avec limitation stricte de taille
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

// Protections anti-injections et pollution
app.use(hpp());
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    logger.warn(`[SANITIZE] Champ suspect nettoye: ${key} - IP: ${req.ip} - RequestID: ${req.id}`);
  }
}));
app.use(sanitizationMiddleware);

// Route de base
app.get('/', (req, res) => {
  res.status(200).send('Yely API (Iron Dome) is running');
});

// ==========================================
// ENREGISTREMENT DES ROUTES (VERSIONING)
// ==========================================
const API_V1_PREFIX = '/api/v1';

app.use(`${API_V1_PREFIX}/health`, healthRoutes);
app.use(`${API_V1_PREFIX}/auth`, authRoutes);
app.use(`${API_V1_PREFIX}/users`, userRoutes);
app.use(`${API_V1_PREFIX}/rides`, rideRoutes);

// Gestion de la route avec ou sans 's' (Alias)
app.use(`${API_V1_PREFIX}/subscriptions`, subscriptionRoutes);
app.use(`${API_V1_PREFIX}/subscription`, subscriptionRoutes); 

app.use(`${API_V1_PREFIX}/admin`, adminRoutes);
app.use(`${API_V1_PREFIX}/notifications`, notificationRoutes);
app.use(`${API_V1_PREFIX}/reports`, reportRoutes);
app.use(`${API_V1_PREFIX}/pois`, poiRoutes);
app.use(`${API_V1_PREFIX}/agents`, agentRoutes);

// MODULE E-COMMERCE (MARKETPLACE)
app.use(`${API_V1_PREFIX}/products`, productRoutes);
app.use(`${API_V1_PREFIX}/orders`, orderRoutes);
app.use(`${API_V1_PREFIX}/ledger`, ledgerRoutes);

// 404 Fallback
app.use((req, res) => {
  logger.warn(`[404] Endpoint non trouve: ${req.method} ${req.url} - RequestID: ${req.id}`);
  res.status(404).json({ success: false, message: "La ressource demandee est introuvable." });
});

// Gestionnaire d'erreurs global en bout de chaîne
app.use(errorHandler);

module.exports = app;
  
