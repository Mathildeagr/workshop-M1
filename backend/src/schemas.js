const { z } = require("zod");
const { PLAYABLE } = require("./events/rules");

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

const primitive = z.union([z.number().finite(), z.boolean(), z.string().max(100), z.null()]);

const numericMap = z.record(identifier, z.number().finite())
    .refine((o) => Object.keys(o).length <= 24, "24 champs maximum");

const alertSchema = z.object({
    type: identifier,
    level: z.enum(["info", "warning", "critical"]).default("info"),
    value: z.union([
        primitive,
        z.record(identifier, primitive).refine((o) => Object.keys(o).length <= 10, "10 champs maximum"),
    ]).optional(),

    detail: z.string().max(100).optional(),
    origin: z.enum(["sensor", "command", "model"]).optional(),
    source: identifier.optional(),
    ts: z.iso.datetime({ offset: true }).optional(),

    // Nœud esp01
    uptime_s: z.number().int().nonnegative().optional(),
    seq: z.number().int().nonnegative().optional(),
    cmd_id: identifier.optional(),

    // Brique predict-anomalie
    detector: z.string().max(50).optional(),
    score: z.number().min(0).max(1).optional(),
    magnitude: z.number().nonnegative().optional(),
    velocity: z.number().nonnegative().optional(),
    jump: z.number().nonnegative().optional(),
    sensitivity: z.enum(["low", "medium", "high"]).optional(),
    window_days: z.number().positive().optional(),
    effective_days: z.number().nonnegative().optional(),
    rates: numericMap.optional(),
    contributions: numericMap.optional(),
}).strict();

// Visages (service vision) : mêmes règles de nom que côté Python
const faceNameSchema = z.object({ name: identifier });
const faceStatusSchema = z.object({ status: z.enum(["autorise", "interdit"]) }).strict();
// Enrôlement par la webcam (équivalent de "enroll.py add")
const faceCaptureSchema = z.object({
    name: identifier,
    status: z.enum(["autorise", "interdit"]).default("autorise"),
    samples: z.number().int().min(1).max(30).default(10),
}).strict();


const alertQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    acknowledged: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

const idParamSchema = z.object({
    id: z.coerce.number().int().positive(),
});

const commandSchema = z.discriminatedUnion("event", [
    z.object({
        node: identifier,
        event: z.enum([...PLAYABLE]),
    }).strict(),
    z.object({
        node: identifier,
        event: z.enum(["activate", "deactivate"]),
        target: z.enum(["intrusion", "sabotage", "environnement", "tout"]).default("tout"),
        signal: z.enum(["sonore", "lumineux", "tous"]).default("tous"),
    }).strict(),
]);

const predictiveConfigSchema = z.object({
    sensitivity: z.enum(["low", "medium", "high"]).optional(),
    window_days: z.number().positive().max(3650).optional(),
}).strict().refine((o) => o.sensitivity || o.window_days, "sensitivity ou window_days requis");


const readingsQuerySchema = z.object({
    node: identifier.default("esp01"),
    hours: z.coerce.number().positive().max(24 * 365).default(24),
    limit: z.coerce.number().int().min(1).max(2000).default(1440),
});

const metricsQuerySchema = z.object({
    node: identifier.default("esp01"),
    limit: z.coerce.number().int().min(1).max(500).default(50),
});

const commandQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    node: identifier.optional(),
});

module.exports = {
    loginSchema, createUserSchema, alertSchema, alertQuerySchema, idParamSchema, faceNameSchema, faceStatusSchema,
    faceCaptureSchema, commandSchema, commandQuerySchema, predictiveConfigSchema, readingsQuerySchema, metricsQuerySchema,
};
