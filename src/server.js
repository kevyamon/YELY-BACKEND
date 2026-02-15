// src/server.js
// SERVEUR YÉLY - Anti-Spoofing GPS, Redis GEO & BullMQ Worker
// CSCSM Level: Bank Grade

const http = require('http');
const app = require('./app');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis'); // npm install ioredis
const User = require('./models/User');
const startRideWorker = require('./workers/rideWorker');
const { env } = require('./config/env');
const logger = require('./config/logger');

const server = http.createServer(app);

// -------------------------------------------------------------
// 🚀 CONFIGURATION REDIS (Moteur de performance)
// -------------------------------------------------------------
const redis = new Redis(env.REDIS_URL);
redis.on('error', (err) => logger.error('Redis Error:', err));
redis.on('connect', () => logger.info('✅ Redis connecté (Rate Limit & GEO)'));

/**
 * RATE LIMIT VIA REDIS
 * Remplace le Map() local pour survivre aux redémarrages.
 */
const checkSocketRateLimit = async (userId) => {
  const key = `ratelimit:socket:${userId}`;
  const now = Date.now();
  const lastUpdate = await redis.get(key);
  
  if (lastUpdate && now - parseInt(lastUpdate) < 1000) return false;
  
  // TTL de 60s pour ne pas encombrer Redis
  await redis.set(key, now, 'EX', 60);
  return true;
};
// -------------------------------------------------------------

const io = new Server(server, {
  cors: {
    origin: env.FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket'],
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6
});

// Injection des instances pour accès dans les contrôleurs si besoin
app.set('socketio', io);
app.set('redis', redis);

// 🛡️ DÉMARRAGE DU WORKER BULLMQ
// Remplace le setInterval global par une gestion par job beaucoup plus fine
startRideWorker(io);

// Helper Distance (Haversine)
const getDistKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; 
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180; 
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

// Middleware Auth Socket
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('AUTH_TOKEN_MISSING'));

    const decoded = jwt.verify(token, env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password -__v').lean();
    
    if (!user || user.isBanned) return next(new Error('AUTH_REJECTED'));
    
    socket.user = user;
    socket.lastLocTime = Date.now();
    socket.lastCoords = user.currentLocation?.coordinates || [0,0]; 
    
    next();
  } catch (err) {
    next(new Error('AUTH_FAILED'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;
  socket.join(user._id.toString());
  if (user.role === 'driver') socket.join('drivers');

  // UPDATE LOCATION (Avec Anti-Spoofing & Redis GEO)
  socket.on('update_location', async (coords) => {
    if (!coords?.latitude || !coords?.longitude) return;
    
    // Rate limit basé sur Redis
    const isAllowed = await checkSocketRateLimit(user._id.toString());
    if (!isAllowed) return;

    const now = Date.now();
    const timeDiffSeconds = (now - socket.lastLocTime) / 1000;
    
    if (timeDiffSeconds > 1) {
      const [prevLng, prevLat] = socket.lastCoords;
      const distanceKm = getDistKm(prevLat, prevLng, coords.latitude, coords.longitude);
      const speedKmH = distanceKm / (timeDiffSeconds / 3600);

      if (speedKmH > 200) {
        logger.warn(`[ANTI-SPOOFING] ${user.name}: ${speedKmH.toFixed(0)} km/h détecté.`);
        return; 
      }
    }

    socket.lastLocTime = now;
    socket.lastCoords = [coords.longitude, coords.latitude];

    try {
      // 1. Persistance MongoDB
      await User.updateOne({ _id: user._id }, {
        currentLocation: {
          type: 'Point',
          coordinates: [coords.longitude, coords.latitude]
        },
        lastLocationAt: new Date()
      });

      // 2. Indexation Temps Réel Redis (GEO)
      // Uniquement pour les chauffeurs disponibles
      if (user.role === 'driver') {
        // On ajoute/met à jour la position dans l'index 'active_drivers'
        await redis.geoadd('active_drivers', coords.longitude, coords.latitude, user._id.toString());
        // Expire après 2 minutes sans update (sécurité si crash app chauffeur)
        await redis.expire('active_drivers', 120);
      }
    } catch (error) {
      logger.error(`[SOCKET LOC] ${user._id}: ${error.message}`);
    }
  });

  socket.on('disconnect', async () => {
    // Nettoyage Redis si le chauffeur se déconnecte proprement
    if (user.role === 'driver') {
      await redis.zrem('active_drivers', user._id.toString());
    }
  });
});

// Démarrage
const startServer = async () => {
  try {
    await mongoose.connect(env.MONGO_URI);
    logger.info('✅ MongoDB connecté');
    
    server.listen(env.PORT, () => {
      logger.info(`🚀 Serveur Yély (Redis Ready) actif sur port ${env.PORT}`);
    });
  } catch (err) {
    logger.error('CRITICAL STARTUP ERROR:', err);
    process.exit(1);
  }
};

startServer();