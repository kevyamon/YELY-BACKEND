// src/config/env.js
// VALIDATION STRICTE ENV - Le projet refuse de démarrer si config invalide
// CSCSM Level: Bank Grade

const dotenv = require('dotenv'); // INDISPENSABLE POUR LE LOCAL
const { z } = require('zod');

// Chargement des variables
dotenv.config();

const envSchema = z.object({
  // Base
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().regex(/^\d+$/).transform(Number).default('5000'),
  
  // Database
  MONGO_URI: z.string().min(1, 'MongoDB URI requis').refine(
    (val) => val.startsWith('mongodb'),
    { message: 'MONGO_URI doit commencer par mongodb' }
  ),
  
  // JWT - Sécurité maximale
  JWT_SECRET: z.string().min(32, 'JWT_SECRET: 32 caractères minimum'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET: 32 caractères minimum'),
  JWT_ACCESS_EXPIRATION: z.string().default('15m'),  // 15 minutes max
  JWT_REFRESH_EXPIRATION: z.string().default('7d'),   // 7 jours
  
  // CORS
  FRONTEND_URL: z.string().url('FRONTEND_URL doit être une URL valide'),
  
  // Admin
  ADMIN_MAIL: z.string().email().optional(),
  
  // Cloudinary
  CLOUDINARY_CLOUD_NAME: z.string().min(1, 'Cloudinary Cloud Name requis'),
  CLOUDINARY_API_KEY: z.string().min(1, 'Cloudinary API Key requise'),
  CLOUDINARY_API_SECRET: z.string().min(1, 'Cloudinary API Secret requis'),

  // Optionnel : Config Bcrypt via Env (sinon défaut en bas)
  BCRYPT_ROUNDS: z.string().transform(Number).optional(),
})
// 🛑 CHECK SÉCURITÉ CRITIQUE (Audit)
.refine((data) => data.JWT_SECRET !== data.JWT_REFRESH_SECRET, {
  message: "CRITIQUE : JWT_SECRET et JWT_REFRESH_SECRET doivent être différents !",
  path: ["JWT_REFRESH_SECRET"],
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ CONFIGURATION INVALIDE - Le serveur refuse de démarrer:');
  
  // Formatage propre des erreurs Zod
  const formattedErrors = parsed.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return `   • ${path}: ${issue.message}`;
  });
  
  formattedErrors.forEach((err) => console.error(err));
  
  process.exit(1);
}

// Export typé et validé
const env = parsed.data;

// Constantes dérivées (pas de calculs dispersés dans le code)
const SECURITY_CONSTANTS = {
  BCRYPT_ROUNDS: env.BCRYPT_ROUNDS || 12, // Force à 12 si pas défini
  MAX_LOGIN_ATTEMPTS: 5,
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  MAX_FILE_SIZE_MB: 5,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  TOKEN_ROTATION: true,
};

module.exports = { 
  env, 
  SECURITY_CONSTANTS,
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
};