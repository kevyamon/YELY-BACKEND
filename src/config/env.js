// src/config/env.js
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().regex(/^\d+$/).transform(Number).default('5000'),
  
  MONGO_URI: z.string().min(1, 'MongoDB URI requis').refine(
    (val) => val.startsWith('mongodb'),
    { message: 'MONGO_URI doit commencer par mongodb' }
  ),

  // REDIS CONFIG
  REDIS_URL: z.string().min(1, 'REDIS_URL requis'),
  
  JWT_SECRET: z.string().min(32, 'JWT_SECRET: 32 caractères minimum'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET: 32 caractères minimum'),
  JWT_ACCESS_EXPIRATION: z.string().default('15m'),
  JWT_REFRESH_EXPIRATION: z.string().default('7d'),
  
  FRONTEND_URL: z.string().url('FRONTEND_URL doit être une URL valide'),
  
  CLOUDINARY_CLOUD_NAME: z.string().min(1, 'Cloudinary Cloud Name requis'),
  CLOUDINARY_API_KEY: z.string().min(1, 'Cloudinary API Key requise'),
  CLOUDINARY_API_SECRET: z.string().min(1, 'Cloudinary API Secret requis'),
  LOCATION_IQ_TOKEN: z.string().min(1, 'Token LocationIQ requis').optional(),
  // ✅ AJOUT POUR FIREBASE (Push Notifications)
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),

  BCRYPT_ROUNDS: z.string().transform(Number).optional(),
})
.refine((data) => data.JWT_SECRET !== data.JWT_REFRESH_SECRET, {
  message: "CRITIQUE : JWT_SECRET et JWT_REFRESH_SECRET doivent être différents !",
  path: ["JWT_REFRESH_SECRET"],
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('CONFIGURATION INVALIDE :');
  parsed.error.issues.forEach((issue) => {
    console.error(`   • ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

const env = parsed.data;

const SECURITY_CONSTANTS = {
  BCRYPT_ROUNDS: env.BCRYPT_ROUNDS || 12,
  MAX_LOGIN_ATTEMPTS: 5,
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
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