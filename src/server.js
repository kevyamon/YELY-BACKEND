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
  
  if (lastUpdate && now - parseInt(lastUpdate) < 1000) return false; 
  
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
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180; 
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('AUTH_TOKEN_MISSING'));

    const decoded = jwt.verify(token, env.JWT_SECRET);
    
    const cacheKey = `auth:user:${decoded.userId}`;
    let user;
    const cachedUser = await redis.get(cacheKey);

    if (cachedUser) {
      user = JSON.parse(cachedUser);
    } else {
      user = await User.findById(decoded.userId)
        .select('_id role isBanned currentLocation isDeleted') 
        .lean();
      
      if (user) await redis.setex(cacheKey, 900, JSON.stringify(user)).catch(() => {});
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

  socket.on('update_location', async (rawData) => {
    const now = Date.now();
    const isDev = process.env.NODE_ENV !== 'production';

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
        logger.warn(`[SOCKET] Verif DB echouée pour ${user._id}, session conservée.`);
      }
    }

    const parseResult = coordsSchema.safeParse(rawData);
    if (!parseResult.success) {
      if (isDev) console.error('[SOCKET] Erreur validation position:', parseResult.error);
      return; 
    }
    const coords = parseResult.data;

    const isAllowed = await checkSocketRateLimit(user._id.toString());
    if (!isAllowed) return;

    const timeDiffSeconds = (now - socket.lastLocTime) / 1000;
    
    if (socket.isFirstLocation) {
      socket.isFirstLocation = false;
    } else if (timeDiffSeconds > 0) { 
      const [prevLng, prevLat] = socket.lastCoords;
      const distanceKm = getDistKm(prevLat, prevLng, coords.latitude, coords.longitude);
      const speedKmH = distanceKm / (timeDiffSeconds / 3600);

      // CORRECTION CRITIQUE : Assouplissement du bouclier Anti-Spoofing. 
      // On encaisse le téléporteur sans déconnecter le chauffeur pour qu'il reçoive la course.
      if (speedKmH > 300) {
        if (!isDev) {
          socket.spoofStrikes += 1;
          if (socket.spoofStrikes >= 5) {
            if (user.role === 'driver') await redis.zrem('active_drivers', user._id.toString());
            socket.emit('force_disconnect', { reason: 'SPOOFING_DETECTED' });
            socket.disconnect(true);
            return;
          }
          // On valide exceptionnellement les coordonnées pour stabiliser le téléporteur
          socket.lastLocTime = now; 
          socket.lastCoords = [coords.longitude, coords.latitude]; 
          return; 
        }
      } else {
        socket.spoofStrikes = 0;
      }
    }

    socket.lastLocTime = now;
    socket.lastCoords = [coords.longitude, coords.latitude];

    try {
      User.updateOne({ _id: user._id }, {
        currentLocation: { type: 'Point', coordinates: [coords.longitude, coords.latitude] },
        lastLocationAt: new Date()
      }).exec().catch(err => logger.error(`[SOCKET LOC DB] ${err.message}`));

      if (user.role === 'driver') {
        await redis.geoadd('active_drivers', coords.longitude, coords.latitude, user._id.toString());
        await redis.expire('active_drivers', 120);

        const activeRide = await Ride.findOne({
          driver: user._id,
          status: { $in: ['accepted', 'in_progress'] }
        }).select('rider').lean();

        if (activeRide) {
          io.to(activeRide.rider.toString()).emit('driver_location_update', {
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
    logger.info('[MONGODB] Base de donnees connectée');
    
    server.listen(env.PORT, '0.0.0.0', () => {
      logger.info(`[SERVER] Serveur Yely actif sur 0.0.0.0:${env.PORT}`);
    });
  } catch (err) {
    logger.error(`[SERVER] Echec critique au demarrage : ${err.message}`);
    process.exit(1);
  }
};

startServer();