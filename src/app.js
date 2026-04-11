// src/app.js
// CONFIGURATION EXPRESS FORTERESSE - Versioning API & Securite Flux
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

// Routes
const authRoutes = require('./routes/authRoutes');
const rideRoutes = require('./routes/rideRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const healthRoutes = require('./routes/healthRoutes');
const poiRoutes = require('./routes/poiRoutes');
const agentRoutes = require('./routes/agentRoutes'); // AJOUT : Module Ambassadeurs

// Extraction des origines autorisees en tableau
const allowedOriginsList = env.ALLOWED_ORIGINS.split(',').map(url => url.trim());

// Initialisation de Sentry au tout debut pour capter les erreurs globales
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.2 : 1.0,
  });
  logger.info('[SENTRY] Monitoring des erreurs active.');
}

const app = express();

app.disable('x-powered-by');

// CORRECTION SENIOR : Trust Proxy active globalement pour garantir l'identification IP correcte 
// derriere Cloudflare/Nginx en dev/staging/prod pour le Rate Limiting.
app.set('trust proxy', 1);

app.use(requestIdMiddleware);

app.use((req, res, next) => {
  logger.http(`${req.method} ${req.url} - IP: ${req.ip} - RequestID: ${req.id}`);
  next();
});

// ==========================================
// CONFIGURATION CORS CORRIGÉE POUR LE CEO
// ==========================================
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    
    if (allowedOriginsList.includes(origin) || env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      logger.warn(`[CORS] Origine rejetee: ${origin}`);
      callback(new Error('Origine non autorisee par la politique CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  // Ajout de 'x-admin-password' pour autoriser ton accès CEO
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With', 
    'Accept', 
    'x-content-type-options', 
    'Origin', 
    'X-Request-ID', 
    'x-admin-password'
  ],
};

// Activation du CORS et gestion automatique des requêtes OPTIONS (Preflight)
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Assouplissement cible du CSP pour les images
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      // Ajout de blob: pour les previews React et *.cloudinary.com pour tous les sous-domaines
      imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com", "https://*.cloudinary.com"],
      connectSrc: ["'self'", ...allowedOriginsList], // Injection du tableau dynamique
    },
  },
  crossOriginEmbedderPolicy: false,
}));

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

// Gestion de la route avec ou sans 's' (Alias)
app.use(`${API_V1_PREFIX}/subscriptions`, subscriptionRoutes);
app.use(`${API_V1_PREFIX}/subscription`, subscriptionRoutes); 

app.use(`${API_V1_PREFIX}/admin`, adminRoutes);
app.use(`${API_V1_PREFIX}/notifications`, require('./routes/notificationRoutes'));
app.use(`${API_V1_PREFIX}/reports`, require('./routes/reportRoutes'));
app.use(`${API_V1_PREFIX}/pois`, poiRoutes);

// INTEGRATION DU MODULE AGENT (Yely Agent PWA)
app.use(`${API_V1_PREFIX}/agents`, agentRoutes);

// ROUTE TEMPORAIRE DE MIGRATION (A SUPPRIMER APRES UTILISATION)
app.get(`${API_V1_PREFIX}/fix-phones-urgence`, async (req, res) => {
  try {
    const User = require('./models/User'); 
    
    const users = await User.find({});
    let updatedCount = 0;
    let details = []; // Pour voir ce qui a ete corrige

    for (const user of users) {
      if (!user.phone) continue;
      
      // 1. On force la donnee en texte quoi qu'il arrive
      const rawPhone = String(user.phone);
      
      // 2. On nettoie tout ce qui n'est pas un chiffre (espaces, tirets)
      const cleanPhone = rawPhone.replace(/\D/g, ''); 
      
      // 3. Si le numero fait exactement 9 chiffres purs, c'est qu'il manque le zero
      if (cleanPhone.length === 9) {
        const fixedPhone = '0' + cleanPhone;
        
        await User.updateOne(
          { _id: user._id }, 
          { $set: { phone: fixedPhone } }
        );
        
        updatedCount++;
        details.push(`${rawPhone} -> ${fixedPhone}`);
      }
    }
    
    res.status(200).json({ 
      success: true, 
      message: `Mission accomplie: ${updatedCount} comptes corriges !`,
      corrections: details
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use((req, res) => {
  logger.warn(`[404] Endpoint non trouve: ${req.method} ${req.url} - RequestID: ${req.id}`);
  res.status(404).json({ success: false, message: "La ressource demandee est introuvable." });
});

app.use(errorHandler);

module.exports = app;