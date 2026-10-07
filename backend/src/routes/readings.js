const express = require("express");
const { QueryTypes } = require("sequelize");
const { sequelize, SensorReading } = require("../models");
const { requireUser } = require("../middleware/auth");
const { readingsQuerySchema, metricsQuerySchema } = require("../schemas");

// Les mesures sont écrites par predict-anomalie (briefing §8) : le backend ne fait que lire.
//   sensor_readings : brut, toutes les 2 s, 7 jours  -> courbes en direct (GET /metrics)
//   sensor_minutes  : agrégé à la minute, conservé  -> historique (GET /readings)

function parseQuery(schema, req, res) {
    const query = schema.safeParse(req.query);
    if (!query.success) {
        res.status(400).json({ error: "Paramètres invalides" });
        return null;
    }
    return query.data;
}

function metricsRouter() {
    const router = express.Router();

    // Format attendu par le dashboard (api.service.ts) : [{ ts, temperature, humidity, gas, motion }], du plus ancien au plus récent
    router.get("/", requireUser, async (req, res) => {
        const query = parseQuery(metricsQuerySchema, req, res);
        if (!query) return;
        const rows = await SensorReading.findAll({
            where: { deviceId: query.node },
            order: [["measuredAt", "DESC"]],
            limit: query.limit,
        });
        res.json(rows.reverse().map((r) => ({
            ts: r.measuredAt.getTime(),
            temperature: r.temperature,
            humidity: r.humidity,
            gas: r.gas,           // nul pendant la chauffe du MQ-2 : la brique écarte ces mesures (§8.4)
            motion: r.motion,
        })));
    });

    return router;
}

function readingsRouter() {
    const router = express.Router();

    // Historique à la minute, avec minima et maxima de température (1 440 points par jour)
    router.get("/", requireUser, async (req, res) => {
        const query = parseQuery(readingsQuerySchema, req, res);
        if (!query) return;
        try {
            const rows = await sequelize.query(
                `SELECT bucket, samples, temperature, temperature_min, temperature_max,
                        humidity, dew_point, gas_ratio, gas, presence_count
                   FROM sensor_minutes
                  WHERE device_id = :node AND bucket >= now() - make_interval(secs => :seconds)
                  ORDER BY bucket DESC
                  LIMIT :limit`,
                { replacements: { node: query.node, seconds: query.hours * 3600, limit: query.limit }, type: QueryTypes.SELECT },
            );
            res.json(rows.reverse());
        } catch (err) {
            // Table créée par predict-anomalie à son premier démarrage
            if (err.original?.code === "42P01") {
                return res.status(503).json({ error: "Historique indisponible : predict-anomalie n'a pas encore créé sensor_minutes" });
            }
            throw err;
        }
    });

    return router;
}

module.exports = { metricsRouter, readingsRouter };
