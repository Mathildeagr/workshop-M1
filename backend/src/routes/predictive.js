const express = require("express");
const config = require("../config");
const { requireUser, requireRole } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { predictiveConfigSchema } = require("../schemas");

const COMMAND_TOPIC = "sentinel/predictive/command";


module.exports = function predictiveRouter({ state, getMqtt }) {
    const router = express.Router();

    for (const path of ["health", "state", "model"]) {
        router.get(`/${path}`, requireUser, async (req, res) => {
            try {
                const upstream = await fetch(`${config.predictUrl}/${path}`, { signal: AbortSignal.timeout(3000) });
                res.status(upstream.ok ? 200 : 502).json(await upstream.json());
            } catch {
                res.status(503).json({ error: "predict-anomalie injoignable" });
            }
        });
    }

    router.get("/config", requireUser, (req, res) => {
        const current = state.config();
        if (!current) return res.status(503).json({ error: "Configuration pas encore reçue de predict-anomalie" });
        res.json(current);
    });

    router.get("/scores", requireUser, (req, res) => res.json(state.scores()));

    function publish(res, message, { retain }) {
        const mqtt = getMqtt();
        if (!mqtt?.connected) return res.status(503).json({ error: "Broker MQTT injoignable" });
        mqtt.publish(COMMAND_TOPIC, JSON.stringify(message), { qos: 1, retain });
        return null;
    }

    router.post("/config", requireUser, requireRole("admin", "superviseur"), validate(predictiveConfigSchema),
        (req, res) => {
            const sent = [];
            if (req.body.sensitivity) {
                const message = { event: "modify_sensitivity", mode: req.body.sensitivity };
                if (publish(res, message, { retain: true })) return;
                sent.push(message);
            }
            if (req.body.window_days) {
                const message = { event: "modify_window", window_days: req.body.window_days };
                if (publish(res, message, { retain: true })) return;
                sent.push(message);
            }
            res.status(202).json({ sent });
        });

    router.post("/retrain", requireUser, requireRole("admin", "superviseur"), (req, res) => {
        const message = { event: "retrain" };
        if (publish(res, message, { retain: false })) return;
        res.status(202).json({ sent: [message] });
    });

    return router;
};
