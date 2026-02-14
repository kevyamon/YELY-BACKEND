// src/server.js
// SERVEUR YÉLY - Socket Sécurisé, Anti-Zombie & Scalable
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
// ABSTRACTION RATE LIMIT (Prêt pour Redis)
// -------------------------------------------------------------
const RateLimitStore = {
  store: new Map(),
  check: function(userId, limitMs = 1000) {
    const now = Date.now();
    const lastUpdate = this.store.get(userId) || 0;
    if (now - lastUpdate < limitMs) return false;
    this.store.set(userId, now);
    return true;
  },
  clear: function(userId) { this.store.delete(userId); }
};

const io = new Server(server, {
  cors: {
    origin: env.FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket'],
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6 // 1MB Max
});

app.set('socketio', io);

// Middleware Auth Socket - Validation Temps Réel
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('AUTH_TOKEN_MISSING'));

    let decoded;
    try {
      // Utilisation du secret Access isolé (Phase 1)
      decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    } catch (err) {
      return next(new Error(`AUTH_TOKEN_${err.name === 'TokenExpiredError' ? 'EXPIRED' : 'INVALID'}`));
    }

    if (decoded.type !== 'access') return next(new Error('AUTH_WRONG_TOKEN_TYPE'));

    const user = await User.findById(decoded.userId).select('name role isBanned isAvailable').lean();
    if (!user) return next(new Error('AUTH_USER_NOT_FOUND'));
    if (user.isBanned) return next(new Error('AUTH_USER_BANNED'));

    socket.user = user;
    next();
  } catch (error) {
    logger.error(`[SOCKET AUTH] ${error.message}`);
    next(new Error('AUTH_CONNECTION_FAILED'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;
  const userIdStr = user._id.toString();

  // 🛡️ SÉCURITÉ ROOMS : Isolation stricte
  socket.join(userIdStr);
  if (user.role === 'driver') {
    socket.join('drivers');
    socket.join(`drivers:${user.forfait || 'standard'}`);
  }

  // UPDATE LOCATION - Anti-Flood & Persistance
  socket.on('update_location', async (coords) => {
    if (!coords?.latitude || !coords?.longitude) return;
    if (!RateLimitStore.check(userIdStr)) return;

    try {
      await User.updateOne({ _id: user._id }, {
        currentLocation: {
          type: 'Point',
          coordinates: [coords.longitude, coords.latitude]
        },
        lastLocationAt: new Date()
      });
    } catch (error) {
      logger.error(`[SOCKET LOC] ${userIdStr}: ${error.message}`);
    }
  });

  // GESTION DES ÉVÉNEMENTS MÉTIER (Proximité / Pancarte)
  socket.on('proximity_reached', (data) => {
    if (!data?.riderId) return;
    // On n'autorise que les chauffeurs à émettre cet événement
    if (user.role !== 'driver') return;

    io.to(data.riderId).emit('driver_arrived', { 
        message: 'Votre Yély est là !',
        driverName: user.name 
    });
  });

  // 🛑 GESTION DE LA DÉCONNEXION (Anti-Zombie)
  socket.on('disconnect', async (reason) => {
    logger.info(`[SOCKET DISCONNECT] ${user.name}: ${reason}`);
    
    if (user.role === 'driver') {
      try {
        // Libération automatique du statut pour éviter les commandes fantômes
        await User.updateOne({ _id: user._id }, { $set: { isAvailable: false } });
        logger.info(`[CLEANUP] Chauffeur ${user.name} marqué indisponible.`);
      } catch (err) {
        logger.error(`[CLEANUP ERROR] ${user.name}: ${err.message}`);
      }
    }
    RateLimitStore.clear(userIdStr);
  });
});

// Démarrage avec protection MongoDB Pool
const startServer = async () => {
  try {
    await mongoose.connect(env.MONGO_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });
    logger.info('✅ MongoDB connecté');
    server.listen(env.PORT, () => {
      logger.info(`🚀 Serveur Yély actif sur port ${env.PORT} [${env.NODE_ENV}]`);
    });
  } catch (err) {
    logger.error(`❌ Échec démarrage: ${err.message}`);
    process.exit(1);
  }
};

// Arrêt Gracieux (Graceful Shutdown)
process.on('SIGTERM', async () => {
  logger.info('SIGTERM reçu, fermeture des connexions...');
  // Marquer tous les chauffeurs connectés comme indisponibles avant de couper ?
  // Optionnel mais recommandé pour une haute disponibilité
  server.close(async () => {
    await mongoose.connection.close();
    process.exit(0);
  });
});

startServer();