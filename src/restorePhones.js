// restorePhones.js
// SCRIPT DE MIGRATION - Restauration des zeros manquants sur les anciens comptes

require('dotenv').config(); // Charge les variables d'environnement
const mongoose = require('mongoose');

// Assure-toi que le chemin pointe bien vers ton modele User
const User = require('./src/models/User'); 

async function runMigration() {
  try {
    console.log('[MIGRATION] Demarrage de la restauration des numeros...');
    
    // Utilise la meme variable d'environnement que ton server.js (ex: MONGO_URI ou MONGODB_URI)
    const dbUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    
    if (!dbUri) {
      throw new Error("L'URI de la base de donnees est introuvable dans le .env");
    }

    await mongoose.connect(dbUri);
    console.log('[MIGRATION] Connexion a la base de donnees reussie.');

    // Recuperation de tous les utilisateurs
    const users = await User.find({});
    let updatedCount = 0;

    console.log(`[MIGRATION] ${users.length} comptes trouves. Analyse en cours...`);

    for (const user of users) {
      const currentPhone = user.phone;
      
      // La regle de detection : 9 caracteres ET ne commence ni par '0' ni par '+'
      if (currentPhone && currentPhone.length === 9 && !currentPhone.startsWith('0') && !currentPhone.startsWith('+')) {
        const fixedPhone = '0' + currentPhone;
        
        // Utilisation de updateOne pour mettre a jour directement dans MongoDB 
        // sans declencher les autres validations (mot de passe, etc.)
        await User.updateOne(
          { _id: user._id }, 
          { $set: { phone: fixedPhone } }
        );
        
        console.log(`[CORRIGE] ${user.name} : ${currentPhone} -> ${fixedPhone}`);
        updatedCount++;
      }
    }

    console.log(`[MIGRATION TERMINEE] ${updatedCount} anciens comptes ont ete restaures avec succes.`);
    process.exit(0);

  } catch (error) {
    console.error('[ERREUR FATALE]', error);
    process.exit(1);
  }
}

runMigration();