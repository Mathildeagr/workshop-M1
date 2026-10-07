const express = require("express");
const { Alert } = require("../models");
const { requireUser, requireRole, requireDevice } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { alertSchema, alertQuerySchema, idParamSchema } = require("../schemas");
const { formatAlert } = require("../events/alertRecord");

/**
 * @param {object} deps  { io, ingest } : ingest est le pipeline partagé avec l'abonné MQTT (events/ingest.js)
 */
module.exports = function alertsRouter({ io, ingest }) {
    const router = express.Router();

    // Route obligatoire du sujet : réservée aux appareils (ESP8266, scripts IA).
    // Même traitement qu'un événement reçu sur le bus MQTT.
    router.post("/", requireDevice, validate(alertSchema), async (req, res) => {
        let result;
        try {
            result = await ingest(req.body, req.device.id, { ip: req.ip });
        } catch (err) {
            if (err.status) return res.status(err.status).json({ error: err.message });
            throw err;
        }
        if (result.kind === "ack") {
            return res.status(202).json({ acknowledged: true, command: result.command?.id ?? null });
        }
        if (result.kind === "duplicate") {
            return res.status(200).json({ duplicate: true });   // déjà reçu par le bus : rien de plus à faire
        }
        res.status(201).json({ ...result.alert, command: result.command });
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
