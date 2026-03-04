// src/app.js [MODIFIÉ]
// CONFIGURATION EXPRESS FORTERESSE - Versioning API & Securite Flux
// CSCSM Level: Bank Grade

const express = require('express');
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

// Routes
const authRoutes = require('./routes/authRoutes');
const rideRoutes = require('./routes/rideRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const healthRoutes = require('./routes/healthRoutes');
const poiRoutes = require('./routes/poiRoutes');

const app = express();

app.disable('x-powered-by');

if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(requestIdMiddleware);

app.use((req, res, next) => {
  logger.http(`${req.method} ${req.url} - IP: ${req.ip} - RequestID: ${req.id}`);
  next();
});

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

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowedOrigins = [env.FRONTEND_URL];
    if (allowedOrigins.includes(origin) || env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      logger.warn(`[CORS] Origine rejetee: ${origin}`);
      callback(new Error('Origine non autorisee par la politique CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'x-content-type-options', 'Origin', 'X-Request-ID'],
};
app.use(cors(corsOptions));

app.use('/api/', apiLimiter);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

app.use(hpp());
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    logger.warn(`[SANITIZE] Champ suspect nettoye: ${key} - IP: ${req.ip} - RequestID: ${req.id}`);
  }
}));
app.use(sanitizationMiddleware);

app.get('/', (req, res) => {
  res.status(200).send('Yely API (Iron Dome) is running');
});

const API_V1_PREFIX = '/api/v1';

app.use(`${API_V1_PREFIX}/health`, healthRoutes);
app.use(`${API_V1_PREFIX}/auth`, authRoutes);
app.use(`${API_V1_PREFIX}/users`, userRoutes);
app.use(`${API_V1_PREFIX}/rides`, rideRoutes);
app.use(`${API_V1_PREFIX}/subscriptions`, subscriptionRoutes);
app.use(`${API_V1_PREFIX}/admin`, adminRoutes);

// --- NOUVELLES ROUTES ---
app.use(`${API_V1_PREFIX}/notifications`, require('./routes/notificationRoutes'));
app.use(`${API_V1_PREFIX}/reports`, require('./routes/reportRoutes'));
app.use(`${API_V1_PREFIX}/pois`, poiRoutes);

app.use((req, res) => {
  logger.warn(`[404] Endpoint non trouve: ${req.method} ${req.url} - RequestID: ${req.id}`);
  res.status(404).json({ success: false, message: "La ressource demandee est introuvable." });
});

app.use(errorHandler);

module.exports = app;