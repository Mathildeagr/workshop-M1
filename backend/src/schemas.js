const { z } = require("zod");

// Identifiants courts et sans caractères spéciaux : pas d'injection possible dans les logs ou le dashboard
const identifier = z.string().trim().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/, "Caractères autorisés : lettres, chiffres, _ et -");

const loginSchema = z.object({
    username: z.string().trim().min(1).max(50),
    password: z.string().min(1).max(128),
}).strict();

const createUserSchema = z.object({
    username: identifier,
    password: z.string().min(12, "12 caractères minimum").max(128),
    role: z.enum(["admin", "superviseur", "lecteur"]),
}).strict();

// La source n'est pas dans le body : elle vient de la clé d'appareil (anti-usurpation)
const alertSchema = z.object({
    type: identifier,
    level: z.enum(["info", "warning", "critical"]).default("info"),
    value: z.union([z.number().finite(), z.boolean(), z.string().max(100)]).optional(),
}).strict();

// Query string : toujours des chaînes, d'où les conversions
const alertQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    acknowledged: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

const idParamSchema = z.object({
    id: z.coerce.number().int().positive(),
});

module.exports = { loginSchema, createUserSchema, alertSchema, alertQuerySchema, idParamSchema };
