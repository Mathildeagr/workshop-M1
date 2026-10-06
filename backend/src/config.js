// Configuration centralisée : toutes les variables d'environnement passent par ici
require("dotenv").config();

function required(name) {
    const value = process.env[name];
    if (!value) {
        console.error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
        process.exit(1);
    }
    return value;
}

function list(value) {
    return (value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

// DEVICE_API_KEYS="esp01:cle1,vision:cle2" -> Map { "cle1" => "esp01", "cle2" => "vision" }
function parseDeviceKeys(value) {
    const keys = new Map();
    for (const entry of list(value)) {
        const [id, key] = entry.split(":");
        if (!id || !key || key.length < 32) {
            console.error(`DEVICE_API_KEYS invalide pour "${id}" (format id:cle, cle >= 32 caractères)`);
            process.exit(1);
        }
        keys.set(key, id);
    }
    return keys;
}

const jwtSecret = required("JWT_SECRET");
if (jwtSecret.length < 32) {
    console.error("JWT_SECRET doit faire au moins 32 caractères");
    process.exit(1);
}

module.exports = {
    port: Number(process.env.PORT) || 3000,
    databaseUrl: required("DATABASE_URL"),
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
    corsOrigins: list(process.env.CORS_ORIGINS || "http://localhost:4200"),
    // Nombre de proxys devant l'API (1 = Traefik). 0 en local : sinon X-Forwarded-For serait falsifiable
    trustProxy: Number(process.env.TRUST_PROXY) || 0,
    deviceKeys: parseDeviceKeys(process.env.DEVICE_API_KEYS),
    admin: {
        username: process.env.ADMIN_USERNAME,
        password: process.env.ADMIN_PASSWORD,
    },
};
