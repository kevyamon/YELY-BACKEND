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
const bannerRoutes = require('./routes/bannerRoutes');
const reviewRoutes = require('./routes/reviewRoutes');

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

// Route de base (avec pont de redirection natif pour Google OAuth mobile)
app.get('/', (req, res) => {
  const code = req.query.code || '';
  const token = req.query.access_token || req.query.id_token || '';
  
  if (code || token) {
    const targetUrl = `yely://google-auth?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`;
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Redirection Yély...</title>
          <script>
            window.location.href = "${targetUrl}";
          </script>
        </head>
        <body style="background:#0A0C10;color:#D4AF37;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;margin:0;">
          <h2 style="margin-bottom:10px;">Connexion Yély réussie !</h2>
          <p style="color:rgba(255,255,255,0.7);font-size:14px;">Redirection vers l'application en cours...</p>
          <a href="${targetUrl}" style="margin-top:20px;padding:12px 24px;background:#D4AF37;color:#121418;text-decoration:none;border-radius:20px;font-weight:bold;">Ouvrir Yély</a>
        </body>
      </html>
    `);
  }
  
  res.status(200).send('Yely API (Iron Dome) is running');
});

// Route publique de partage de boutique via slug ou ID
app.get('/shop/:slug', require('./controllers/userShareController').shareSellerShopBySlug);

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
app.use(`${API_V1_PREFIX}/banners`, bannerRoutes);
app.use(`${API_V1_PREFIX}/reviews`, reviewRoutes);

// 404 Fallback
app.use((req, res) => {
  logger.warn(`[404] Endpoint non trouve: ${req.method} ${req.url} - RequestID: ${req.id}`);
  res.status(404).json({ success: false, message: "La ressource demandee est introuvable." });
});

// Gestionnaire d'erreurs global en bout de chaîne
app.use(errorHandler);

module.exports = app;
  
