// src/server.js
// SERVEUR YELY - Mode Dev & Production (Rolling Sessions Actives & Redis Optimisé & Anti-Zombie)
// STANDARD: Industriel / Bank Grade

const http = require('http');
const app = require('./app');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { z } = require('zod'); 

const redis = require('./config/redis'); 

const User = require('./models/User');
const Ride = require('./models/Ride');
const startRideWorker = require('./workers/rideWorker');
const startCloudinaryCleanupWorker = require('./workers/cloudinaryCleanupWorker');
const { env } = require('./config/env');
const logger = require('./config/logger');

const server = http.createServer(app);

const checkSocketRateLimit = async (userId) => {
  const key = `ratelimit:socket:${userId}`;
  const now = Date.now();
  const lastUpdate = await redis.get(key);
  
  if (lastUpdate && now - Number(lastUpdate) < 1000) return false; 
  
  await redis.set(key, now, 'EX', 60);
  return true;
};

const coordsSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  heading: z.number().optional(),
  speed: z.number().optional(),
  timestamp: z.number().optional()
});

const io = new Server(server, {
  cors: {
    origin: env.FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket'],
  pingInterval: 25000,
  pingTimeout: 120000,
  maxHttpBufferSize: 5000 
});

io.adapter(createAdapter(redis.pubClient, redis.subClient));

app.set('socketio', io);
app.set('redis', redis);

startRideWorker(io);
startCloudinaryCleanupWorker();

const getDistKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180; 
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2); 
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('AUTH_TOKEN_MISSING'));

    const decoded = jwt.verify(token, env.JWT_SECRET);
    
    const cacheKey = `auth:user:${decoded.userId}`;
    const cachedUser = await redis.get(cacheKey);
    
    const user = cachedUser ? JSON.parse(cachedUser) : await User.findById(decoded.userId).select('_id role isBanned currentLocation isDeleted').lean();

    if (!cachedUser && user) {
      await redis.setex(cacheKey, 900, JSON.stringify(user)).catch(() => {});
    }
    
    if (!user || user.isBanned || user.isDeleted) return next(new Error('AUTH_REJECTED'));
    
    socket.user = user;
    socket.lastLocTime = Date.now();
    socket.lastCoords = user.currentLocation?.coordinates || [0,0]; 
    socket.spoofStrikes = 0; 
    socket.lastDbCheck = Date.now(); 
    socket.isFirstLocation = true; 
    
    next();
  } catch (err) {
    next(new Error('AUTH_FAILED'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user; 
  
  socket.join(user._id.toString());
  if (user.role === 'driver') socket.join('drivers');
  if (user.role === 'admin' || user.role === 'superadmin') socket.join('admins');

  socket.on('update_location', async (rawData) => {
    const now = Date.now();
    const isDev = env.NODE_ENV !== 'production';

    // Anti-Zombie / Rolling session check
    if (now - socket.lastDbCheck > 300000) { 
      socket.lastDbCheck = now;
      try {
        const dbUser = await User.findById(user._id).select('_id isBanned isDeleted').lean();
        if (!dbUser || dbUser.isBanned || dbUser.isDeleted) {
          if (user.role === 'driver') await redis.zrem('active_drivers', user._id.toString());
          socket.emit('force_disconnect', { reason: 'SESSION_REVOKED' });
          socket.disconnect(true);
          return;
        }
      } catch (err) {
        logger.warn(`[SOCKET] Verif DB echouee pour ${user._id}, session conservee.`);
      }
    }

    const parseResult = coordsSchema.safeParse(rawData);
    if (!parseResult.success) return; 
    const coords = parseResult.data;

    const isAllowed = await checkSocketRateLimit(user._id.toString());
    if (!isAllowed) return;

    const timeDiffSeconds = (now - socket.lastLocTime) / 1000;
    
    // Anti-Spoofing
    if (socket.isFirstLocation) {
      socket.isFirstLocation = false;
    } else if (timeDiffSeconds > 0) { 
      const [prevLng, prevLat] = socket.lastCoords;
      const distanceKm = getDistKm(prevLat, prevLng, coords.latitude, coords.longitude);
      const effectiveTimeDiff = Math.max(timeDiffSeconds, 1);
      const speedKmH = distanceKm / (effectiveTimeDiff / 3600);

      if (speedKmH > 300 && !isDev) {
        socket.spoofStrikes += 1;
        if (socket.spoofStrikes >= 5) {
          if (user.role === 'driver') await redis.zrem('active_drivers', user._id.toString());
          socket.emit('force_disconnect', { reason: 'SPOOFING_DETECTED' });
          socket.disconnect(true);
          return;
        }
        socket.lastLocTime = now; 
        socket.lastCoords = [coords.longitude, coords.latitude]; 
        return; 
      } else {
        socket.spoofStrikes = 0;
      }
    }

    socket.lastLocTime = now;
    socket.lastCoords = [coords.longitude, coords.latitude];

    try {
      if (user.role === 'driver') {
        // Mise a jour de la position sans ecraser la TTL globale
        await redis.geoadd('active_drivers', coords.longitude, coords.latitude, user._id.toString());

        // OPTIMISATION CRITIQUE : Cache du passager (rider) pour epargner MongoDB
        const rideCacheKey = `driver:${user._id}:active_rider`;
        let riderId = await redis.get(rideCacheKey);

        if (!riderId) {
          const activeRide = await Ride.findOne({
            driver: user._id,
            status: { $in: ['accepted', 'in_progress'] }
          }).select('rider').lean();

          if (activeRide) {
            riderId = activeRide.rider.toString();
            // On cache la relation Chauffeur-Client pendant 30 secondes
            await redis.setex(rideCacheKey, 30, riderId);
          } else {
            // Pour eviter de spammer la DB meme si pas de course, on met un cache vide court (5s)
            await redis.setex(rideCacheKey, 5, 'NONE');
          }
        }

        if (riderId && riderId !== 'NONE') {
          io.to(riderId).emit('driver_location_update', {
            latitude: coords.latitude,
            longitude: coords.longitude,
            heading: coords.heading || 0,
            speed: coords.speed || 0
          });
        }
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

const startServer = async () => {
  try {
    await mongoose.connect(env.MONGO_URI);
    logger.info('[MONGODB] Base de donnees connectee');
    
    server.listen(env.PORT, '0.0.0.0', () => {
      logger.info(`[SERVER] Serveur Yely actif sur 0.0.0.0:${env.PORT}`);
    });
  } catch (err) {
    logger.error(`[SERVER] Echec critique au demarrage : ${err.message}`);
    process.exit(1);
  }
};

startServer();
                              
