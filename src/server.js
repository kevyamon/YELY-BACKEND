// src/server.js
// SERVEUR YELY - Mode Dev: Abonnement bypasse pour tests
// CSCSM Level: Bank Grade

const http = require('http');
const app = require('./app');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const { z } = require('zod'); 
const User = require('./models/User');
const Ride = require('./models/Ride');
const startRideWorker = require('./workers/rideWorker');
const { env } = require('./config/env');
const logger = require('./config/logger');

const server = http.createServer(app);

const redis = new Redis(env.REDIS_URL);
redis.on('error', (err) => logger.error('Redis Error:', err));
redis.on('connect', () => logger.info('Redis connecte (Rate Limit & GEO)'));

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

app.set('socketio', io);
app.set('redis', redis);

startRideWorker(io);

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
      user = await User.findById(decoded.userId).select('-password -__v').lean();
      if (user) await redis.setex(cacheKey, 900, JSON.stringify(user));
    }
    
    if (!user || user.isBanned) return next(new Error('AUTH_REJECTED'));
    
    socket.user = user;
    socket.lastLocTime = Date.now();
    socket.lastCoords = user.currentLocation?.coordinates || [0,0]; 
    socket.spoofStrikes = 0; 
    
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
    const isSessionValid = await redis.exists(`auth:user:${user._id}`);
    if (!isSessionValid) {
      if (user.role === 'driver') await redis.zrem('active_drivers', user._id.toString());
      socket.emit('force_disconnect', { reason: 'SESSION_REVOKED' });
      socket.disconnect(true);
      return;
    }

    const parseResult = coordsSchema.safeParse(rawData);
    if (!parseResult.success) {
      if (__DEV__) console.error('[SOCKET] Erreur validation position:', parseResult.error);
      return; 
    }
    
    const coords = parseResult.data;

    const isAllowed = await checkSocketRateLimit(user._id.toString());
    if (!isAllowed) return;

    const now = Date.now();
    const timeDiffSeconds = (now - socket.lastLocTime) / 1000;
    
    if (timeDiffSeconds > 0) { 
      const [prevLng, prevLat] = socket.lastCoords;
      const distanceKm = getDistKm(prevLat, prevLng, coords.latitude, coords.longitude);
      const speedKmH = distanceKm / (timeDiffSeconds / 3600);

      if (speedKmH > 200) {
        socket.spoofStrikes += 1;
        if (socket.spoofStrikes >= 3) {
          if (user.role === 'driver') await redis.zrem('active_drivers', user._id.toString());
          socket.emit('force_disconnect', { reason: 'SPOOFING_DETECTED' });
          socket.disconnect(true);
          return;
        }
        socket.lastLocTime = now; 
        return; 
      } else {
        socket.spoofStrikes = 0;
      }
    }

    socket.lastLocTime = now;
    socket.lastCoords = [coords.longitude, coords.latitude];

    try {
      await User.updateOne({ _id: user._id }, {
        currentLocation: { type: 'Point', coordinates: [coords.longitude, coords.latitude] },
        lastLocationAt: new Date()
      });

      if (user.role === 'driver') {
        await redis.geoadd('active_drivers', coords.longitude, coords.latitude, user._id.toString());
        await redis.expire('active_drivers', 120);

        const activeRide = await Ride.findOne({
          driver: user._id,
          status: { $in: ['accepted', 'ongoing'] }
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
    logger.info('MongoDB connecte');
    
    server.listen(env.PORT, () => {
      logger.info(`Serveur Yely actif sur port ${env.PORT}`);
    });
  } catch (err) {
    process.exit(1);
  }
};

startServer();