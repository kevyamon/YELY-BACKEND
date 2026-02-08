const http = require('http');
const app = require('./app');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('./models/User');

const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: process.env.FRONTEND_URL || "*", 
    methods: ["GET", "POST"] 
  }
});

// Partager l'instance 'io' pour l'utiliser dans les contrôleurs (ex: rideController)
app.set('socketio', io);

// --- MIDDLEWARE SÉCURITÉ SOCKET (Vérification du Token JWT) ---
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.token;
    
    if (!token) {
      return next(new Error("Authentification échouée : Aucun token fourni."));
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (user) {
      socket.user = user;
      next();
    } else {
      next(new Error("Utilisateur non trouvé dans la Forteresse."));
    }
  } catch (err) {
    next(new Error("Token invalide ou expiré."));
  }
});

// --- GESTION DES CONNEXIONS EN TEMPS RÉEL ---
io.on('connection', (socket) => {
  console.log(`🔌 Connecté : ${socket.user.name} (${socket.user.role})`);

  // Chaque utilisateur rejoint une "room" privée basée sur son propre ID
  socket.join(socket.user._id.toString());

  // Les chauffeurs rejoignent une salle commune pour recevoir les alertes de courses
  if (socket.user.role === 'driver') {
    socket.join('drivers');
  }

  // 1. MISE À JOUR GPS (Le chauffeur envoie ses coordonnées)
  socket.on('update_location', async (coords) => {
    // coords = { longitude, latitude }
    try {
      await User.findByIdAndUpdate(socket.user._id, {
        currentLocation: { 
          type: 'Point', 
          coordinates: [coords.longitude, coords.latitude] 
        }
      });
    } catch (error) {
      console.error("Erreur mise à jour GPS:", error);
    }
  });

  // 2. ALERTE DE PROXIMITÉ ULTRA-PRÉCISE (< 10 MÈTRES)
  // Déclenché par le téléphone du chauffeur quand il détecte qu'il est arrivé
  socket.on('proximity_reached', (data) => {
    // data = { riderId }
    if (data.riderId) {
      io.to(data.riderId).emit('driver_arrived', {
        message: "Votre Yély est là ! Il est à moins de 10 mètres.",
        action: "ACTIVER_PANCARTE"
      });
      console.log(`🎯 CIBLE ATTEINTE : Chauffeur à moins de 10m du client ${data.riderId}`);
    }
  });

  // 3. INNOVATION : PANCARTE NUMÉRIQUE (Handshake Visuel)
  socket.on('show_pancarte', (data) => {
    // data = { targetUserId }
    if (data.targetUserId) {
      io.to(data.targetUserId).emit('pancarte_active', { 
          senderName: socket.user.name,
          message: "L'autre personne a activé sa pancarte numérique ! Identifiez-la visuellement." 
      });
      console.log(`✨ Pancarte activée de ${socket.user.name} vers ${data.targetUserId}`);
    }
  });

  // 4. DÉCONNEXION
  socket.on('disconnect', () => {
    console.log(`❌ Déconnexion : ${socket.user.name}`);
  });
});

// --- DÉMARRAGE DE LA FORTERESSE ---
const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 Forteresse Yély active sur le port ${PORT}`);
    });
  })
  .catch(err => {
    console.error("❌ Échec de connexion MongoDB :", err);
    process.exit(1); 
  });