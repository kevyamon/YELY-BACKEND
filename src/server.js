// src/server.js
// SERVEUR YÉLY - Socket Sécurisé & Scalable
// CSCSM Level: Bank Grade

const http = require('http');
const app = require('./app');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const { env } = require('./config/env');
const logger = require('./config/logger');

const server = http.createServer(app);

// -------------------------------------------------------------
// ABSTRACTION RATE LIMIT (Préparation Redis)
// -------------------------------------------------------------
// En production clusterisée, ceci sera remplacé par un client Redis.
const RateLimitStore = new Map();

const checkSocketRateLimit = (userId) => {
  const now = Date.now();
  const lastUpdate = RateLimitStore.get(userId) || 0;
  
  // Limite : 1 update toutes les 1000ms (Protection Flood)
  if (now - lastUpdate < 1000) return false;
  
  RateLimitStore.set(userId, now);
  return true;
};
// -------------------------------------------------------------

const io = new Server(server, {
  cors: {
    origin: env.FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket'], // Websocket only (Performance)
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6 // 1MB Max payload
});

app.set('socketio', io);

// Middleware Auth Socket
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('AUTH_TOKEN_MISSING'));

    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') return next(new Error('AUTH_TOKEN_EXPIRED'));
      return next(new Error('AUTH_TOKEN_INVALID'));
    }

    if (decoded.type !== 'access') return next(new Error('AUTH_WRONG_TOKEN_TYPE'));

    // Optimisation: Lean() pour éviter la surcharge mémoire
    const user = await User.findById(decoded.userId).select('-password -__v').lean();
    if (!user) return next(new Error('AUTH_USER_NOT_FOUND'));
    if (user.isBanned) return next(new Error('AUTH_USER_BANNED'));

    // Anti-Tampering Rôle
    if (decoded.role && decoded.role !== user.role) {
      logger.warn(`[SOCKET SECURITY] Rôle mismatch: Token ${decoded.role} vs DB ${user.role}`);
      return next(new Error('AUTH_ROLE_MISMATCH'));
    }

    socket.user = user;
    logger.info(`[SOCKET CONNECT] ${user.name} (${user.role}) connected`);
    next();
  } catch (error) {
    logger.error(`[SOCKET HANDSHAKE] Error: ${error.message}`);
    next(new Error('AUTH_CONNECTION_FAILED'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;

  socket.join(user._id.toString());
  socket.join(`role:${user.role}`);

  if (user.role === 'driver') {
    socket.join('drivers');
  }

  // UPDATE LOCATION (Avec Rate Limit Externalisé)
  socket.on('update_location', async (coords) => {
    if (!coords?.latitude || !coords?.longitude) return;

    // Utilisation du Store abstrait
    if (!checkSocketRateLimit(user._id.toString())) return;

    try {
      // Optimisation: updateOne est plus rapide que findByIdAndUpdate
      await User.updateOne({ _id: user._id }, {
        currentLocation: {
          type: 'Point',
          coordinates: [coords.longitude, coords.latitude]
        },
        lastLocationAt: new Date()
      });
    } catch (error) {
      logger.error(`[SOCKET LOC] ${user._id}: ${error.message}`);
    }
  });

  // Autres événements (Proximité, Pancarte...)
  socket.on('proximity_reached', (data) => {
    if (!data?.riderId) return;
    io.to(data.riderId).emit('driver_arrived', { 
        message: 'Votre Yély est là !',
        driverName: user.name 
    });
    logger.info(`[SOCKET EVENT] Proximité: ${user.name} -> ${data.riderId}`);
  });

  socket.on('show_pancarte', (data) => {
    if (!data?.targetUserId) return;
    io.to(data.targetUserId).emit('pancarte_active', {
      senderName: user.name,
      message: `${user.name} a activé sa pancarte !`
    });
    logger.info(`[SOCKET EVENT] Pancarte: ${user.name} -> ${data.targetUserId}`);
  });

  socket.on('disconnect', (reason) => {
    logger.info(`[SOCKET DISCONNECT] ${user.name}: ${reason}`);
  });
});

// Démarrage
const PORT = env.PORT;
const startServer = async () => {
  try {
    await mongoose.connect(env.MONGO_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    logger.info('✅ MongoDB connecté');
    server.listen(PORT, () => {
      logger.info(`🚀 Serveur Yély actif sur port ${PORT}`);
      logger.info(`🔒 Mode: ${env.NODE_ENV}`);
    });
  } catch (err) {
    logger.error(`❌ Échec démarrage: ${err.message}`);
    process.exit(1);
  }
};

process.on('SIGTERM', async () => {
  logger.info('SIGTERM reçu, arrêt gracieux...');
  server.close();
  await mongoose.connection.close();
  process.exit(0);
});

startServer();