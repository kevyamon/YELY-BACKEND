// src/server.js
// SERVEUR YÉLY - Anti-Spoofing GPS & Auto-Cleanup
// CSCSM Level: Bank Grade

const http = require('http');
const app = require('./app');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const rideService = require('./services/rideService'); // Pour le Cron
const { env } = require('./config/env');
const logger = require('./config/logger');

const server = http.createServer(app);

// -------------------------------------------------------------
// GESTION MÉMOIRE & RATE LIMIT (Anti-DoS)
// -------------------------------------------------------------
const RateLimitStore = new Map();

// Nettoyage automatique du Map toutes les 5 minutes (Garbage Collection)
// Empêche la fuite de mémoire signalée par l'audit
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of RateLimitStore.entries()) {
    if (now - timestamp > 60000) { // Si inactif depuis 1 min
      RateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

const checkSocketRateLimit = (userId) => {
  const now = Date.now();
  const lastUpdate = RateLimitStore.get(userId) || 0;
  if (now - lastUpdate < 1000) return false; // Max 1 update / sec
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
  transports: ['websocket'],
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6
});

app.set('socketio', io);

// 🛡️ CRON "MAISON" : Vérification des Négociations Bloquées (Toutes les 30s)
setInterval(() => {
  rideService.releaseStuckNegotiations(io).catch(err => console.error('Cron Error:', err));
}, 30000);

// Helper Distance (Haversine) pour l'Anti-Spoofing
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
    // Initialisation pour Anti-Spoofing
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
  socket.join(`role:${user.role}`);
  if (user.role === 'driver') socket.join('drivers');

  // UPDATE LOCATION (Avec Anti-Spoofing GPS)
  socket.on('update_location', async (coords) => {
    if (!coords?.latitude || !coords?.longitude) return;
    if (!checkSocketRateLimit(user._id.toString())) return;

    // 🛡️ ANTI-SPOOFING : Calcul de Vitesse
    const now = Date.now();
    const timeDiffSeconds = (now - socket.lastLocTime) / 1000;
    
    // On ignore le tout premier point ou si temps trop court (< 1s déjà géré par RateLimit)
    if (timeDiffSeconds > 1) {
      const [prevLng, prevLat] = socket.lastCoords;
      const distanceKm = getDistKm(prevLat, prevLng, coords.latitude, coords.longitude);
      
      // Vitesse = Distance / Temps (en Heures)
      const speedKmH = distanceKm / (timeDiffSeconds / 3600);

      // Limite physique : 200 km/h (Marge pour erreurs GPS légitimes)
      // Si > 200 km/h, c'est de la téléportation -> On rejette
      if (speedKmH > 200) {
        logger.warn(`[ANTI-SPOOFING] Rejet update ${user.name}: ${speedKmH.toFixed(0)} km/h détecté.`);
        return; 
      }
    }

    // Mise à jour valide
    socket.lastLocTime = now;
    socket.lastCoords = [coords.longitude, coords.latitude];

    try {
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

  // Autres événements...
  socket.on('disconnect', () => {});
});

// Démarrage
const PORT = env.PORT;
const startServer = async () => {
  try {
    await mongoose.connect(env.MONGO_URI);
    logger.info('✅ MongoDB connecté');
    server.listen(PORT, () => {
      logger.info(`🚀 Serveur Yély (Iron Dome) actif sur port ${PORT}`);
    });
  } catch (err) {
    process.exit(1);
  }
};

startServer();