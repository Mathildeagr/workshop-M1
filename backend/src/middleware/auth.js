const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");

function decode(token) {
    try {
        return jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    } catch {
        return null;
    }
}

function verifyToken(token) {
    const payload = decode(token);
    return payload && !payload.purpose ? payload : null;
}

function signToken(user, roleName) {
    return jwt.sign(
        { sub: String(user.id), username: user.username, role: roleName },
        config.jwtSecret,
        { algorithm: "HS256", expiresIn: config.jwtExpiresIn },
    );
}

function signTicket(user, purpose, expiresIn = "60s") {
    return jwt.sign({ sub: user.sub, purpose }, config.jwtSecret, { algorithm: "HS256", expiresIn });
}

function verifyTicket(token, purpose) {
    const payload = decode(token);
    return payload && payload.purpose === purpose ? payload : null;
}

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

function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: "Droits insuffisants" });
        }
        next();
    };
}

function requireDevice(req, res, next) {
    const deviceId = findDevice(req.get("X-API-Key"));
    if (!deviceId) {
        return res.status(401).json({ error: "Clé d'appareil invalide" });
    }
    req.device = { id: deviceId };
    next();
}

module.exports = { verifyToken, signToken, signTicket, verifyTicket, requireUser, requireRole, requireDevice };
