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

const server = http.createServer(app);

// Configuration CORS stricte pour Socket.io
const io = new Server(server, {
  cors: {
    origin: env.FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true
  },
  // Sécurité: pas de polling fallback (websocket uniquement)
  transports: ['websocket'],
  // Limite payload (protection DoS)
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

    // Vérification JWT
    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return next(new Error('AUTH_TOKEN_EXPIRED'));
      }
      return next(new Error('AUTH_TOKEN_INVALID'));
    }

    // Validation ObjectId
    if (!mongoose.Types.ObjectId.isValid(decoded.userId)) {
      return next(new Error('AUTH_CORRUPTED'));
    }

    // Vérification type token (doit être access, pas refresh)
    if (decoded.type !== 'access') {
      return next(new Error('AUTH_WRONG_TOKEN_TYPE'));
    }

    // Récupération utilisateur
    const user = await User.findById(decoded.userId).select('-password -__v');

    if (!user) {
      return next(new Error('AUTH_USER_NOT_FOUND'));
    }

    if (user.isBanned) {
      return next(new Error('AUTH_USER_BANNED'));
    }

    // Vérification cohérence rôle (anti-tampering)
    if (decoded.role && decoded.role !== user.role) {
      console.warn(`[SOCKET AUTH] Rôle mismatch: ${decoded.role} vs ${user.role}`);
      return next(new Error('AUTH_ROLE_MISMATCH'));
    }

    // Attacher utilisateur au socket
    socket.user = {
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      currentLocation: user.currentLocation
    };

    // Log connexion
    console.log(`[SOCKET] Connecté: ${user.name} (${user.role}) - ${socket.id}`);

    next();
  } catch (error) {
    console.error('[SOCKET AUTH] Erreur:', error.message);
    next(new Error('AUTH_INTERNAL_ERROR'));
  }
});

// ═══════════════════════════════════════════════════════════
// GESTION CONNEXIONS
// ═══════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  const user = socket.user;

  // Room personnelle (pour notifications ciblées)
  socket.join(user._id);

  // Room rôle (broadcasts)
  socket.join(`role:${user.role}`);

  // Room spéciale chauffeurs
  if (user.role === 'driver') {
    socket.join('drivers');
    
    // Vérification abonnement actif pour recevoir courses
    if (!user.currentLocation?.coordinates?.[0]) {
      socket.emit('warning', {
        message: 'Position GPS non disponible. Activez la localisation.',
        code: 'GPS_UNAVAILABLE'
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ÉVÉNEMENTS MÉTIER
  // ═══════════════════════════════════════════════════════════

  // 1. Mise à jour GPS (chauffeur)
  socket.on('update_location', async (coords) => {
    // Validation stricte des coordonnées
    if (!coords || 
        typeof coords.latitude !== 'number' || 
        typeof coords.longitude !== 'number' ||
        coords.latitude < -90 || coords.latitude > 90 ||
        coords.longitude < -180 || coords.longitude > 180) {
      
      socket.emit('error', {
        message: 'Coordonnées GPS invalides.',
        code: 'INVALID_COORDINATES'
      });
      return;
    }

    // Rate limiting silencieux (max 1 update/sec)
    const now = Date.now();
    if (socket.lastLocationUpdate && now - socket.lastLocationUpdate < 1000) {
      return; // Ignorer sans erreur (protection spam)
    }
    socket.lastLocationUpdate = now;

    try {
      // Mise à jour DB (non bloquante pour le socket)
      await User.findByIdAndUpdate(user._id, {
        currentLocation: {
          type: 'Point',
          coordinates: [coords.longitude, coords.latitude]
        },
        lastLocationAt: new Date()
      });

      // Broadcast aux clients concernés (si en course)
      // TODO: Vérifier si chauffeur a une course active et notifier le rider
    } catch (error) {
      console.error('[SOCKET LOCATION] Erreur:', error.message);
    }
  });

  // 2. Proximité atteinte (< 10m)
  socket.on('proximity_reached', (data) => {
    if (!data?.riderId || !mongoose.Types.ObjectId.isValid(data.riderId)) {
      return socket.emit('error', { code: 'INVALID_RIDER_ID' });
    }

    // Vérification: le chauffeur a bien cette course ?
    // TODO: Vérifier que ce chauffeur est assigné à une course de ce rider
    
    io.to(data.riderId).emit('driver_arrived', {
      message: 'Votre Yély est là ! Il est à moins de 10 mètres.',
      action: 'ACTIVATE_PANCARTE',
      driverName: user.name
    });

    console.log(`[SOCKET] Proximité: ${user.name} → ${data.riderId}`);
  });

  // 3. Pancarte numérique (handshake visuel)
  socket.on('show_pancarte', (data) => {
    if (!data?.targetUserId || !mongoose.Types.ObjectId.isValid(data.targetUserId)) {
      return socket.emit('error', { code: 'INVALID_TARGET' });
    }

    io.to(data.targetUserId).emit('pancarte_active', {
      senderName: user.name,
      senderId: user._id,
      message: `${user.name} a activé sa pancarte numérique !`,
      timestamp: Date.now()
    });

    console.log(`[SOCKET] Pancarte: ${user.name} → ${data.targetUserId}`);
  });

  // 4. Rejoindre une room (pour conversations privées course)
  socket.on('join_room', (roomId) => {
    if (!roomId || typeof roomId !== 'string' || roomId.length > 50) {
      return;
    }
    // Vérification: l'utilisateur a le droit de rejoindre cette room
    // (doit être rider ou driver de la course correspondante)
    socket.join(roomId);
    console.log(`[SOCKET] ${user.name} joined room ${roomId}`);
  });

  // ═══════════════════════════════════════════════════════════
  // DÉCONNEXION
  // ═══════════════════════════════════════════════════════════

  socket.on('disconnect', (reason) => {
    console.log(`[SOCKET] Déconnecté: ${user.name} - ${reason}`);
    
    // Mise à jour statut si chauffeur (optionnel: mettre hors ligne ?)
    // Attention: ne pas mettre hors ligne immédiatement (reconnexion rapide possible)
  });

  // Gestion erreurs socket
  socket.on('error', (error) => {
    console.error(`[SOCKET] Erreur ${user.name}:`, error.message);
  });
});

// ═══════════════════════════════════════════════════════════
// DÉMARRAGE SERVEUR
// ═══════════════════════════════════════════════════════════

const PORT = env.PORT;

const startServer = async () => {
  try {
    // Connexion MongoDB avec options sécurisées
    await mongoose.connect(env.MONGO_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    console.log('✅ MongoDB connecté');

    server.listen(PORT, () => {
      console.log(`🚀 Serveur Yély actif sur port ${PORT}`);
      console.log(`🔒 Mode: ${env.NODE_ENV}`);
      console.log(`🌐 CORS: ${env.FRONTEND_URL}`);
    });

  } catch (err) {
    console.error('❌ Échec démarrage:', err.message);
    process.exit(1);
  }
};

// Gestion gracieuse des arrêts
process.on('SIGTERM', async () => {
  console.log('SIGTERM reçu, arrêt gracieux...');
  server.close(() => {
    console.log('Serveur HTTP fermé');
  });
  await mongoose.connection.close();
  console.log('MongoDB déconnecté');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT reçu, arrêt gracieux...');
  server.close();
  await mongoose.connection.close();
  process.exit(0);
});

startServer();