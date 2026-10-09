const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");
const config = require("../config");

const corsOptions = { origin: config.corsOrigins };

const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Trop de requêtes" },
});

// Anti brute-force sur le login
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Trop de tentatives de connexion, réessayez plus tard" },
});

function applySecurity(app) {
    app.disable("x-powered-by");
    app.set("trust proxy", config.trustProxy);
    app.use(helmet());
    app.use(cors(corsOptions));
    app.use(globalLimiter);
    app.use(express.json({ limit: "10kb" }));
}

function errorHandler(err, req, res, next) {
    if (err.type === "entity.parse.failed") {
        return res.status(400).json({ error: "JSON invalide" });
    }
    if (err.type === "entity.too.large") {
        return res.status(413).json({ error: "Payload trop volumineux" });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur interne" });
}

module.exports = { applySecurity, errorHandler, loginLimiter, corsOptions };
