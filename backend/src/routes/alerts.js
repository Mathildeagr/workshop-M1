const express = require("express");
const { Alert, Device } = require("../models");
const { requireUser, requireRole, requireDevice } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { alertSchema, alertQuerySchema, idParamSchema } = require("../schemas");

// Format unique envoyé au dashboard (REST et Socket.io)
function formatAlert(alert) {
    return {
        id: alert.id,
        source: alert.deviceId,
        type: alert.type,
        level: alert.level,
        value: alert.value,
        acknowledged: alert.acknowledged,
        acknowledgedBy: alert.acknowledgedBy,
        acknowledgedAt: alert.acknowledgedAt,
        createdAt: alert.createdAt,
    };
}

module.exports = function alertsRouter(io) {
    const router = express.Router();

    // Route obligatoire du sujet : réservée aux appareils (ESP8266, scripts IA)
    router.post("/", requireDevice, validate(alertSchema), async (req, res) => {
        const alert = await Alert.create({ ...req.body, deviceId: req.device.id });
        await Device.update({ lastSeen: new Date(), ip: req.ip }, { where: { id: req.device.id } });

        const payload = formatAlert(alert);
        io.emit("alert", payload);          // push instantané vers le dashboard
        res.status(201).json(payload);
    });

    // ?limit=50&acknowledged=false : les plus récentes d'abord
    router.get("/", requireUser, async (req, res) => {
        const query = alertQuerySchema.safeParse(req.query);
        if (!query.success) {
            return res.status(400).json({ error: "Paramètres invalides" });
        }
        const { limit, acknowledged } = query.data;
        const alerts = await Alert.findAll({
            where: acknowledged === undefined ? {} : { acknowledged },
            order: [["createdAt", "DESC"]],
            limit,
        });
        res.json(alerts.map(formatAlert));
    });

    // Le superviseur signale qu'il a pris l'alerte en compte
    router.patch("/:id/ack", requireUser, requireRole("admin", "superviseur"), async (req, res) => {
        const params = idParamSchema.safeParse(req.params);
        if (!params.success) {
            return res.status(400).json({ error: "Identifiant invalide" });
        }
        const alert = await Alert.findByPk(params.data.id);
        if (!alert) {
            return res.status(404).json({ error: "Alerte introuvable" });
        }
        if (!alert.acknowledged) {
            await alert.update({ acknowledged: true, acknowledgedBy: Number(req.user.sub), acknowledgedAt: new Date() });
        }

        const payload = formatAlert(alert);
        io.emit("alert_ack", payload);
        res.json(payload);
    });

    return router;
};
