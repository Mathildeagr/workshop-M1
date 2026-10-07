const express = require("express");
const config = require("../config");
const { requireUser, requireRole } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { predictiveConfigSchema } = require("../schemas");

const COMMAND_TOPIC = "sentinel/predictive/command";

/**
 * Brique predict-anomalie : lecture de son état (relais de ses routes internes, briefing §9.8)
 * et réglages envoyés sur le bus (§9.5). Elle reste sur le réseau interne : seul le backend lui parle.
 * @param {object} deps  { state, getMqtt } : getMqtt() renvoie le client MQTT (null tant qu'il n'est pas connecté)
 */
module.exports = function predictiveRouter({ state, getMqtt }) {
    const router = express.Router();

    // Lecture : /health, /state (score, silence de chaque nœud), /model (apprentissage), /config
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

    // Configuration effective : celle publiée par la brique sur son topic retenu, sans aller-retour HTTP.
    // Le dashboard doit afficher window_days (demandé) ET effective_days (réellement couvert), §10.4.
    router.get("/config", requireUser, (req, res) => {
        const current = state.config();
        if (!current) return res.status(503).json({ error: "Configuration pas encore reçue de predict-anomalie" });
        res.json(current);
    });

    // Derniers scores reçus (un par nœud), pour initialiser la courbe avant les messages Socket.io "score"
    router.get("/scores", requireUser, (req, res) => res.json(state.scores()));

    function publish(res, message, { retain }) {
        const mqtt = getMqtt();
        if (!mqtt?.connected) return res.status(503).json({ error: "Broker MQTT injoignable" });
        mqtt.publish(COMMAND_TOPIC, JSON.stringify(message), { qos: 1, retain });
        return null;
    }

    // Réglages de l'opérateur. QoS 1 et RETENU (§9.5) : la brique retrouve le dernier réglage à son redémarrage.
    // L'accusé est la nouvelle configuration publiée par la brique (événement Socket.io predictive_config).
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

    // Réapprentissage immédiat. JAMAIS retenu : sinon la brique réapprendrait à chacun de ses redémarrages.
    router.post("/retrain", requireUser, requireRole("admin", "superviseur"), (req, res) => {
        const message = { event: "retrain" };
        if (publish(res, message, { retain: false })) return;
        res.status(202).json({ sent: [message] });
    });

    return router;
};
