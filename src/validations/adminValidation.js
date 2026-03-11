// src/validations/adminValidation.js
// CONTRATS DE GOUVERNANCE - Zod Strict
// CSCSM Level: Bank Grade

const { z } = require('zod');

const mongoId = z.string().regex(/^[0-9a-fA-F]{24}$/, "ID invalide");

const updateRoleSchema = z.object({
  userId: mongoId,
  action: z.enum(['PROMOTE', 'REVOKE'])
}).strict();

const toggleBanSchema = z.object({
  userId: mongoId,
  reason: z.string().min(4, "La raison doit etre explicite").max(500).trim()
}).strict();

const mapSettingsSchema = z.object({
  isMapLocked: z.boolean(),
  serviceCity: z.string().min(2).max(100).trim(),
  radius: z.number().min(1).max(500),
  allowedCenter: z.object({
    coordinates: z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90)
    ])
  })
}).strict();

const transactionIdParam = z.object({
  id: mongoId
});

const rejectTransactionSchema = z.object({
  reason: z.string().min(5, "Raison de rejet trop courte").max(200).trim()
}).strict();

// --- AJOUT VERSIONING (Vague 1) ---
const updateAppVersionSchema = z.object({
  latestVersion: z.string().min(3, "Format de version invalide").max(20).trim(),
  mandatoryUpdate: z.boolean(),
  updateUrl: z.string().url("URL de telechargement invalide")
}).strict();

module.exports = {
  updateRoleSchema,
  toggleBanSchema,
  mapSettingsSchema,
  transactionIdParam,
  rejectTransactionSchema,
  updateAppVersionSchema
};