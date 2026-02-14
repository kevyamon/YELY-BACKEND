// src/server.js
// SERVEUR YÉLY - Socket sécurisé, Validation JWT, Gestion gracieuse des déconnexions
// CSCSM Level: Bank Grade

const http = require('http');
const app = require('./app');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const { env } = require('./config/env');
const logger = require('./config/logger'); // Ajout Logger

const server = http.createServer(app);

// Configuration CORS stricte pour Socket.io
const io = new Server(server, {
  cors: {
    origin: env.FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket'], // Sécurité: WebSocket uniquement
  maxHttpBufferSize: 1e6, // 1MB
  pingTimeout: 60000,
  pingInterval: 25000
});

// Partager io avec les contrôleurs
app.set('socketio', io);

// ═══════════════════════════════════════════════════════════
// MIDDLEWARE AUTH SOCKET (Validation JWT stricte)
// ═══════════════════════════════════════════════════════════

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error('AUTH_TOKEN_MISSING'));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return next(new Error('AUTH_TOKEN_EXPIRED'));
      }
      return next(new Error('AUTH_TOKEN_INVALID'));
    }

    if (!mongoose.Types.ObjectId.isValid(decoded.userId)) {
      return next(new Error('AUTH_CORRUPTED'));
    }

    if (decoded.type !== 'access') {
      return next(new Error('AUTH_WRONG_TOKEN_TYPE'));
    }

    const user = await User.findById(decoded.userId).select('-password -__v');

    if (!user) return next(new Error('AUTH_USER_NOT_FOUND'));
    if (user.isBanned) return next(new Error('AUTH_USER_BANNED'));

    if (decoded.role && decoded.role !== user.role) {
      logger.warn(`[SOCKET AUTH] Rôle mismatch: ${decoded.role} vs ${user.role}`);
      return next(new Error('AUTH_ROLE_MISMATCH'));
    }

    socket.user = {
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      currentLocation: user.currentLocation
    };

    logger.info(`[SOCKET] Connecté: ${user.name} (${user.role}) - ${socket.id}`);
    next();
  } catch (error) {
    logger.error(`[SOCKET AUTH] Erreur: ${error.message}`);
    next(new Error('AUTH_INTERNAL_ERROR'));
  }
});

// ═══════════════════════════════════════════════════════════
// GESTION CONNEXIONS
// ═══════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  const user = socket.user;

  socket.join(user._id);
  socket.join(`role:${user.role}`);

  if (user.role === 'driver') {
    socket.join('drivers');
    if (!user.currentLocation?.coordinates?.[0]) {
      socket.emit('warning', {
        message: 'Position GPS non disponible. Activez la localisation.',
        code: 'GPS_UNAVAILABLE'
      });
    }
  }

  // --- ÉVÉNEMENTS MÉTIER ---

  socket.on('update_location', async (coords) => {
    if (!coords || 
        typeof coords.latitude !== 'number' || 
        typeof coords.longitude !== 'number') {
      socket.emit('error', { message: 'Coordonnées GPS invalides.' });
      return;
    }

    // Rate limiting silencieux
    const now = Date.now();
    if (socket.lastLocationUpdate && now - socket.lastLocationUpdate < 1000) return;
    socket.lastLocationUpdate = now;

    try {
      await User.findByIdAndUpdate(user._id, {
        currentLocation: {
          type: 'Point',
          coordinates: [coords.longitude, coords.latitude]
        },
        lastLocationAt: new Date()
      });
    } catch (error) {
      logger.error(`[SOCKET LOCATION] Erreur: ${error.message}`);
    }
  });

  socket.on('proximity_reached', (data) => {
    if (!data?.riderId) return;
    io.to(data.riderId).emit('driver_arrived', {
      message: 'Votre Yély est là !',
      driverName: user.name
    });
    logger.info(`[SOCKET] Proximité: ${user.name} → ${data.riderId}`);
  });

  socket.on('show_pancarte', (data) => {
    if (!data?.targetUserId) return;
    io.to(data.targetUserId).emit('pancarte_active', {
      senderName: user.name,
      message: `${user.name} a activé sa pancarte !`
    });
    logger.info(`[SOCKET] Pancarte: ${user.name} → ${data.targetUserId}`);
  });

  socket.on('join_room', (roomId) => {
    if (roomId) {
      socket.join(roomId);
      logger.debug(`[SOCKET] ${user.name} joined room ${roomId}`);
    }
  });

  socket.on('disconnect', (reason) => {
    logger.info(`[SOCKET] Déconnecté: ${user.name} - ${reason}`);
  });

  socket.on('error', (error) => {
    logger.error(`[SOCKET] Erreur ${user.name}: ${error.message}`);
  });
});

// ═══════════════════════════════════════════════════════════
// DÉMARRAGE SERVEUR
// ═══════════════════════════════════════════════════════════

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