// src/validations/authValidation.js
// CONTRATS DE DONNEES AUTH - Zod Strict
// CSCSM Level: Bank Grade

const { z } = require('zod');
const crypto = require('crypto');

const DISPOSABLE_DOMAINS = [
  'tempmail.com', '10minutemail.com', 'guerrillamail.com', 
  'yopmail.com', 'mailinator.com', 'throwaway.com'
];

// Verification k-Anonymity via Have I Been Pwned
const isPasswordPwned = async (password) => {
  try {
    const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    
    // Appel externe (ne pas bloquer l'app si l'API externe est down)
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!response.ok) return false; 
    
    const text = await response.text();
    const hashes = text.split('\n');
    
    for (let line of hashes) {
      const [h, count] = line.split(':');
      if (h === suffix) return true; 
    }
    return false;
  } catch (error) {
    return false; // Fail-open pour eviter de bloquer les inscriptions sur erreur reseau
  }
};

const registerSchema = z.object({
  name: z.string()
    .min(2, 'Votre nom doit contenir au moins 2 lettres.')
    .max(50, 'Votre nom est un peu trop long (maximum 50 caracteres).')
    .regex(/^[a-zA-Z\u00C0-\u00FF\s'-]+$/, 'Votre nom ne doit contenir ni chiffres ni caracteres speciaux.')
    .trim(),
    
  email: z.string()
    .email('Veuillez fournir une adresse e-mail valide.')
    .toLowerCase()
    .trim()
    .refine((email) => {
      const domain = email.split('@')[1];
      return !DISPOSABLE_DOMAINS.includes(domain);
    }, 'Les adresses e-mail temporaires ne sont pas autorisees.'),

  phone: z.string()
    .regex(/^\+?[0-9\s]{8,20}$/, 'Veuillez fournir un numero de telephone valide.')
    .trim(),

  password: z.string()
    .min(12, 'Votre mot de passe doit faire au moins 12 caracteres.')
    .max(128, 'Votre mot de passe est trop long.')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, 
      'Pour votre securite, le mot de passe doit inclure une majuscule, un chiffre et un symbole.')
    .refine(async (password) => {
      const pwned = await isPasswordPwned(password);
      return !pwned;
    }, "Ce mot de passe est apparu dans une fuite de donnees publique. Veuillez en choisir un autre pour votre securite."),

  role: z.enum(['rider', 'driver']).default('rider')
}).strict();

const loginSchema = z.object({
  identifier: z.string()
    .min(3, 'L\'identifiant est trop court.')
    .max(254, 'L\'identifiant est trop long.')
    .trim(),
    
  password: z.string()
    .min(1, 'Le mot de passe est requis.'),
    
  clientPlatform: z.string().optional()
}).strict();

const availabilitySchema = z.object({
  isAvailable: z.boolean({
    required_error: 'Le statut de disponibilite est requis.',
    invalid_type_error: 'La valeur fournie est invalide.'
  })
});

const forgotPasswordSchema = z.object({
  email: z.string()
    .email('Veuillez fournir une adresse e-mail valide.')
    .toLowerCase()
    .trim()
}).strict();

const resetPasswordSchema = z.object({
  email: z.string()
    .email('Veuillez fournir une adresse e-mail valide.')
    .toLowerCase()
    .trim(),
    
  otp: z.string()
    .length(6, 'Le code de securite doit contenir exactement 6 chiffres.')
    .regex(/^\d+$/, 'Le code ne doit contenir que des chiffres.'),
    
  newPassword: z.string()
    .min(12, 'Le nouveau mot de passe doit faire au moins 12 caracteres.')
    .max(128, 'Le nouveau mot de passe est trop long.')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, 
      'Pour votre securite, le mot de passe doit inclure une majuscule, un chiffre et un symbole.')
    .refine(async (password) => {
      const pwned = await isPasswordPwned(password);
      return !pwned;
    }, "Ce mot de passe est apparu dans une fuite de donnees publique. Veuillez en choisir un autre pour votre securite.")
}).strict();

module.exports = {
  registerSchema,
  loginSchema,
  availabilitySchema,
  forgotPasswordSchema,
  resetPasswordSchema
};