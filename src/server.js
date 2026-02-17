// src/server.js
// SERVEUR YÉLY - Anti-Spoofing GPS, Redis GEO, Cache Auth & BullMQ Worker
// CSCSM Level: Bank Grade

const http = require('http');
const app = require('./app');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const { z } = require('zod'); // 🛡️ AJOUT DE ZOD POUR LA SÉCURITÉ DES PAYLOADS SOCKET
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

const checkSocketRateLimit = async (userId) => {
  const key = `ratelimit:socket:${userId}`;
  const now = Date.now();
  const lastUpdate = await redis.get(key);
  
  if (lastUpdate && now - parseInt(lastUpdate) < 1000) return false; // Max 1 event/sec
  
  await redis.set(key, now, 'EX', 60);
  return true;
};
// -------------------------------------------------------------

// 🛡️ SCHÉMA DE VALIDATION ZOD POUR LES COORDONNÉES ENTRANTES
const coordsSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
}).strict();

const io = new Server(server, {
  cors: {
    origin: env.FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket'],
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6 // Limite à 1MB le payload Socket pour contrer les DoS
});

app.set('socketio', io);
app.set('redis', redis);

// 🛡️ DÉMARRAGE DU WORKER BULLMQ
startRideWorker(io);

// Helper Distance (Haversine)
const getDistKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; 
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180; 
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

// Middleware Auth Socket avec Cache Redis (Réduit la charge sur MongoDB)
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('AUTH_TOKEN_MISSING'));

    const decoded = jwt.verify(token, env.JWT_SECRET);
    
    // 🚀 OPTIMISATION: Cache Redis pour l'authentification WebSocket
    const cacheKey = `auth:user:${decoded.userId}`;
    let user;
    const cachedUser = await redis.get(cacheKey);

    if (cachedUser) {
      user = JSON.parse(cachedUser);
    } else {
      user = await User.findById(decoded.userId).select('-password -__v').lean();
      if (user) await redis.setex(cacheKey, 900, JSON.stringify(user));
    }
    
    if (!user || user.isBanned) return next(new Error('AUTH_REJECTED'));
    
    socket.user = user;
    socket.lastLocTime = Date.now();
    socket.lastCoords = user.currentLocation?.coordinates || [0,0]; // [Lng, Lat]
    
    next();
  } catch (err) {
    next(new Error('AUTH_FAILED'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user; 
  
  socket.join(user._id.toString());
  if (user.role === 'driver') socket.join('drivers');

  // UPDATE LOCATION (Avec Anti-Spoofing Corrigé, Cache Redis & Mur Zod)
  socket.on('update_location', async (rawData) => {
    // 🛡️ 1. Validation stricte du payload via Zod (Protège contre les crashs JS)
    const parseResult = coordsSchema.safeParse(rawData);
    if (!parseResult.success) {
      logger.warn(`[SOCKET SECURITY] Payload malformé rejeté pour l'utilisateur ${user._id}`);
      return; 
    }
    
    const coords = parseResult.data;

    // 🚪 2. Vérification de l'abonnement
    if (user.role === 'driver' && (!user.subscription || !user.subscription.isActive)) {
      await redis.zrem('active_drivers', user._id.toString());
      socket.emit('subscription_expired', { message: 'Abonnement inactif. Position non partagée.' });
      return; 
    }
    
    // 3. Rate limit basé sur Redis
    const isAllowed = await checkSocketRateLimit(user._id.toString());
    if (!isAllowed) return;

    const now = Date.now();
    const timeDiffSeconds = (now - socket.lastLocTime) / 1000;
    
    if (timeDiffSeconds > 0) { 
      const [prevLng, prevLat] = socket.lastCoords;
      const distanceKm = getDistKm(prevLat, prevLng, coords.latitude, coords.longitude);
      const speedKmH = distanceKm / (timeDiffSeconds / 3600);

      if (speedKmH > 200) {
        logger.warn(`[ANTI-SPOOFING] ${user.name}: ${speedKmH.toFixed(0)} km/h détecté.`);
        // 🚀 CORRECTIF : On met à jour le temps, mais on GARDE les anciennes coordonnées.
        // Cela empêche le tricheur d'attendre pour valider sa téléportation !
        socket.lastLocTime = now;
        return; 
      }
    }

    // 4. Mise à jour de l'état du socket
    socket.lastLocTime = now;
    socket.lastCoords = [coords.longitude, coords.latitude];

    try {
      // 5. Persistance MongoDB
      await User.updateOne({ _id: user._id }, {
        currentLocation: {
          type: 'Point',
          coordinates: [coords.longitude, coords.latitude]
        },
        lastLocationAt: new Date()
      });

      // 6. Indexation Temps Réel Redis (GEO)
      if (user.role === 'driver') {
        await redis.geoadd('active_drivers', coords.longitude, coords.latitude, user._id.toString());
        await redis.expire('active_drivers', 120);
      }
    } catch (error) {
      logger.error(`[SOCKET LOC] ${user._id}: ${error.message}`);
    }
  });

  socket.on('disconnect', async () => {
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