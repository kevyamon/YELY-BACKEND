// src/config/env.js
// VALIDATION STRICTE DE L'ENVIRONNEMENT (Fail-Fast)
// STANDARD: Industriel / Bank Grade

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

  REDIS_URL: z.string().min(1, 'REDIS_URL requis'),
  
  JWT_SECRET: z.string().min(32, 'JWT_SECRET: 32 caracteres minimum'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET: 32 caracteres minimum'),
  JWT_ACCESS_EXPIRATION: z.string().default('15m'),
  JWT_REFRESH_EXPIRATION: z.string().default('30d'),
  
  FRONTEND_URL: z.string().url('FRONTEND_URL doit etre une URL valide'),
  
  CLOUDINARY_CLOUD_NAME: z.string().min(1, 'Cloudinary Cloud Name requis'),
  CLOUDINARY_API_KEY: z.string().min(1, 'Cloudinary API Key requise'),
  CLOUDINARY_API_SECRET: z.string().min(1, 'Cloudinary API Secret requis'),
  
  LOCATION_IQ_TOKEN: z.string().min(1, 'Token LocationIQ requis'), 

  FIREBASE_PROJECT_ID: z.string().min(1, 'Firebase Project ID requis'),
  FIREBASE_CLIENT_EMAIL: z.string().email('Firebase Client Email invalide'),
  FIREBASE_PRIVATE_KEY: z.string().min(1, 'Firebase Private Key requise').transform(val => val.replace(/\\n/g, '\n')),

  BCRYPT_ROUNDS: z.string().transform(Number).optional(),

  SENTRY_DSN: z.string().url('SENTRY_DSN doit etre une URL valide').optional(),
})
.refine((data) => data.JWT_SECRET !== data.JWT_REFRESH_SECRET, {
  message: "CRITIQUE : JWT_SECRET et JWT_REFRESH_SECRET doivent etre differents !",
  path: ["JWT_REFRESH_SECRET"],
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[FATAL ERROR] Configuration environnement invalide ou manquante:');
  parsed.error.issues.forEach((issue) => {
    console.error(`  -> ${issue.path.join('.')}: ${issue.message}`);
  });
  console.error('[FATAL ERROR] Le serveur refuse de demarrer pour des raisons de securite.');
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