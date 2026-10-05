const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");

// Vérifie un JWT et renvoie son contenu ({ sub, username, role }), ou null
function verifyToken(token) {
    try {
        return jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    } catch {
        return null;
    }
}

function signToken(user, roleName) {
    return jwt.sign(
        { sub: String(user.id), username: user.username, role: roleName },
        config.jwtSecret,
        { algorithm: "HS256", expiresIn: config.jwtExpiresIn },
    );
}

// Comparaison à temps constant pour ne pas révéler la clé caractère par caractère
function findDevice(apiKey) {
    if (!apiKey) return null;
    const given = Buffer.from(apiKey);
    for (const [key, id] of config.deviceKeys) {
        const expected = Buffer.from(key);
        if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) {
            return id;
        }
    }
    return null;
}

// Utilisateur du dashboard : header "Authorization: Bearer <jwt>"
function requireUser(req, res, next) {
    const [scheme, token] = (req.headers.authorization || "").split(" ");
    const payload = scheme === "Bearer" && token ? verifyToken(token) : null;
    if (!payload) {
        return res.status(401).json({ error: "Authentification requise" });
    }
    req.user = payload;
    next();
}

// À placer après requireUser
function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: "Droits insuffisants" });
        }
        next();
    };
}

// Appareil (ESP8266, scripts IA) : header "X-API-Key: <cle>"
function requireDevice(req, res, next) {
    const deviceId = findDevice(req.get("X-API-Key"));
    if (!deviceId) {
        return res.status(401).json({ error: "Clé d'appareil invalide" });
    }
    req.device = { id: deviceId };
    next();
}

module.exports = { verifyToken, signToken, requireUser, requireRole, requireDevice };
