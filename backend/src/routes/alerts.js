const express = require("express");
const { requireUser, requireDevice } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { alertSchema } = require("../schemas");

// Stockage temporaire en mémoire (remplacé plus tard par la table events)
const MAX_ALERTS = 1000;   // évite de saturer la RAM en cas de flood
const alerts = [];
let nextId = 1;

module.exports = function alertsRouter(io) {
    const router = express.Router();

    // Route obligatoire du sujet : réservée aux appareils (ESP8266, scripts IA)
    router.post("/", requireDevice, validate(alertSchema), (req, res) => {
        const alert = { id: nextId++, source: req.device.id, ...req.body, ts: Date.now() };
        alerts.push(alert);
        if (alerts.length > MAX_ALERTS) alerts.shift();
        io.emit("alert", alert);          // push instantané vers le dashboard
        res.status(201).json(alert);
    });

    router.get("/", requireUser, (req, res) => {
        res.json(alerts);
    });

    return router;
};
