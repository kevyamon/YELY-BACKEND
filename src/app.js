// src/app.js
// CONFIGURATION EXPRESS FORTERESSE - CORS strict avec credentials, sécurité maximale
// CSCSM Level: Bank Grade

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss');
const { env } = require('./config/env');
const { apiLimiter } = require('./middleware/rateLimitMiddleware');

// Routes
const authRoutes = require('./routes/authRoutes');
const rideRoutes = require('./routes/rideRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// Trust proxy uniquement si nécessaire
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

// 2. CORS STRICT - Avec credentials pour cookies httpOnly
const corsOptions = {
  origin: (origin, callback) => {
    // Autorise requêtes sans origin (mobile apps, Postman) en dev uniquement
    if (!origin && env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // Vérifie l'origine contre la whitelist
    const allowedOrigins = [
      env.FRONTEND_URL,
    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Origine rejetée: ${origin}`);
      callback(new Error('Origine non autorisée'));
    }
  },
  credentials: true, // 🔥 IMPORTANT: Permet les cookies httpOnly
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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

// Sanitize XSS
const sanitizeXSS = (obj) => {
  if (typeof obj === 'string') {
    return xss(obj, {
      whiteList: {},
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script']
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeXSS);
  }
  if (obj !== null && typeof obj === 'object') {
    const sanitized = {};
    for (const key of Object.keys(obj)) {
      if (key === '__proto__' || key === 'constructor') continue;
      sanitized[key] = sanitizeXSS(obj[key]);
    }
    return sanitized;
  }
  return obj;
};

app.use((req, res, next) => {
  try {
    if (req.body) req.body = sanitizeXSS(req.body);
    if (req.params) req.params = sanitizeXSS(req.params);
    if (req.query) req.query = sanitizeXSS(req.query);
    next();
  } catch (error) {
    console.error('[XSS SANITIZE] Erreur:', error.message);
    return res.status(400).json({
      success: false,
      message: "Données de requête invalides."
    });
  }
});

// 6. ROUTES API
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
app.use((err, req, res, next) => {
  console.error('[GLOBAL ERROR]', err.stack);
  
  const isDev = env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Erreur serveur.",
    ...(isDev && { stack: err.stack })
  });
});

module.exports = app;