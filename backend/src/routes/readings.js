const express = require("express");
const { QueryTypes } = require("sequelize");
const { sequelize, SensorReading } = require("../models");
const { requireUser } = require("../middleware/auth");
const { readingsQuerySchema, metricsQuerySchema } = require("../schemas");

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
            gas: r.gas,
            motion: r.motion,
        })));
    });

    return router;
}

function readingsRouter() {
    const router = express.Router();

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
            if (err.original?.code === "42P01") {
                return res.status(503).json({ error: "Historique indisponible : predict-anomalie n'a pas encore créé sensor_minutes" });
            }
            throw err;
        }
    });

    return router;
}

module.exports = { metricsRouter, readingsRouter };
