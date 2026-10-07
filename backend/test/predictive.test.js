const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

// config.js exige ces variables au chargement (routes et middleware d'authentification)
process.env.JWT_SECRET ??= "secret-de-test-secret-de-test-secret-de-test";
process.env.DATABASE_URL ??= "postgres://test@127.0.0.1:1/test";
process.env.DOTENV_CONFIG_QUIET = "true";

const express = require("express");
const { alertSchema, predictiveConfigSchema } = require("../src/schemas");
const { createPredictiveState, pickScore } = require("../src/predictive/state");
const { createNodeRegistry } = require("../src/nodes/registry");
const { createIngest } = require("../src/events/ingest");
const { parseTopic } = require("../src/mqtt/client");
const { signToken } = require("../src/middleware/auth");
const predictiveRouter = require("../src/routes/predictive");

// --- État de la brique ------------------------------------------------------------------------------
test("score : relayé au dashboard en ne gardant que les champs du contrat", () => {
    const emitted = [];
    const state = createPredictiveState({ io: { emit: (e, d) => emitted.push({ e, d }) } });
    state.handleScore({ source: "esp01", stage: "anomaly", score: 0.998, magnitude: 4.5, pirate: "<script>" });
    assert.equal(emitted[0].e, "score");
    assert.equal(emitted[0].d.stage, "anomaly");
    assert.equal("pirate" in emitted[0].d, false);
    assert.deepEqual(state.scores().map((s) => s.source), ["esp01"]);
});

test("score : sans source valide, ignoré", () => {
    assert.equal(pickScore({ score: 0.5 }), null);
    assert.equal(pickScore({ source: "esp 01", score: 0.5 }), null);
});

test("config : la fenêtre demandée et la fenêtre couverte sont toutes deux conservées (§10.4)", () => {
    const state = createPredictiveState({ io: { emit: () => {} } });
    state.handleConfig({ sensitivity: "high", window_days: 30, effective_days: 0.25, device_id: "predictive" });
    assert.equal(state.config().window_days, 30);
    assert.equal(state.config().effective_days, 0.25);
    assert.equal(state.config().sensitivity, "high");
});

test("topics : score et config acceptés seulement depuis predictive", () => {
    assert.deepEqual(parseTopic("sentinel/predictive/score"), { node: "predictive", kind: "score" });
    assert.deepEqual(parseTopic("sentinel/predictive/config"), { node: "predictive", kind: "config" });
    assert.equal(parseTopic("sentinel/esp01/score"), null);
    assert.equal(parseTopic("sentinel/vision/config"), null);
});

test("schéma des réglages : au moins un champ, valeurs bornées", () => {
    assert.equal(predictiveConfigSchema.safeParse({ sensitivity: "high" }).success, true);
    assert.equal(predictiveConfigSchema.safeParse({ window_days: 14 }).success, true);
    assert.equal(predictiveConfigSchema.safeParse({}).success, false);
    assert.equal(predictiveConfigSchema.safeParse({ sensitivity: "max" }).success, false);
    assert.equal(predictiveConfigSchema.safeParse({ window_days: -1 }).success, false);
    assert.equal(predictiveConfigSchema.safeParse({ window_days: 7, retrain: true }).success, false);
});

// --- Datation des événements rejoués (§6) ---------------------------------------------------------
test("uptime : estimé à partir de la dernière télémétrie, null si elle est trop ancienne", () => {
    let t = 1_000_000;
    const registry = createNodeRegistry({ io: { emit: () => {} }, raiseAlert: async () => null, now: () => t });
    assert.equal(registry.estimateUptime("esp01"), null);
    registry.handleTelemetry("esp01", { uptime_s: 600 });
    t += 4000;
    assert.equal(registry.estimateUptime("esp01"), 604);
    t += 120_000;
    assert.equal(registry.estimateUptime("esp01"), null);
});

function ingestWithUptime(currentUptime, nowMs) {
    const created = [];
    const ingest = createIngest({
        Alert: { create: async (r) => { created.push(r); return { id: 1, ...r }; } },
        Device: { findByPk: async (id) => ({ id }), update: async () => [1] },
        io: { emit: () => {} },
        commands: { send: () => ({ status: "sent" }), acknowledge: () => null },
        signalSettings: { toReplay: () => [] },
        raiseAlert: async () => null,
        alarmNode: "esp01",
        estimateUptime: () => currentUptime,
        now: () => nowMs,
    });
    return { ingest, created };
}

test("datation : un événement rejoué (uptime 412 reçu à uptime 600) est daté 188 s plus tôt", async () => {
    const now = Date.parse("2026-10-07T10:00:00Z");
    const { ingest, created } = ingestWithUptime(600, now);
    await ingest(alertSchema.parse({ type: "tamper_opened", origin: "sensor", seq: 1, uptime_s: 412 }), "esp01");
    assert.equal(created[0].occurredAt.toISOString(), "2026-10-07T09:56:52.000Z");
});

test("datation : un événement en direct (écart < 5 s) n'est pas redaté", async () => {
    const { ingest, created } = ingestWithUptime(414, Date.now());
    await ingest(alertSchema.parse({ type: "tamper_opened", origin: "sensor", seq: 1, uptime_s: 412 }), "esp01");
    assert.equal(created[0].occurredAt, null);
});

test("datation : uptime inconnu, ou événement d'un boot plus récent -> pas de date inventée", async () => {
    const a = ingestWithUptime(null, Date.now());
    await a.ingest(alertSchema.parse({ type: "tamper_opened", origin: "sensor", seq: 1, uptime_s: 412 }), "esp01");
    assert.equal(a.created[0].occurredAt, null);
    const b = ingestWithUptime(100, Date.now());
    await b.ingest(alertSchema.parse({ type: "tamper_opened", origin: "sensor", seq: 2, uptime_s: 412 }), "esp01");
    assert.equal(b.created[0].occurredAt, null);
});

test("datation : l'horodatage de l'émetteur (ts) a toujours la priorité", async () => {
    const { ingest, created } = ingestWithUptime(600, Date.now());
    await ingest(alertSchema.parse({ type: "env_drift", origin: "model", source: "esp01",
        ts: "2026-10-07T07:05:21+00:00", uptime_s: 10 }), "predictive");
    assert.equal(created[0].occurredAt.toISOString(), "2026-10-07T07:05:21.000Z");
});

// --- Routes /predictive : réglages publiés sur le bus -----------------------------------------------
let server;
let base;
const published = [];
const fakeMqtt = { connected: true, publish: (topic, msg, opts) => published.push({ topic, msg: JSON.parse(msg), opts }) };
const token = (role) => signToken({ id: 1, username: "test" }, role);

before(async () => {
    const app = express();
    app.use(express.json());
    app.use("/predictive", predictiveRouter({ state: createPredictiveState({ io: { emit: () => {} } }), getMqtt: () => fakeMqtt }));
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}/predictive`;
});

after(() => server.close());

const post = (path, body, role = "superviseur") => fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token(role)}` },
    body: JSON.stringify(body ?? {}),
});

test("routes : sensibilité et fenêtre publiées en QoS 1 RETENU sur sentinel/predictive/command", async () => {
    published.length = 0;
    const res = await post("/config", { sensitivity: "high", window_days: 14 });
    assert.equal(res.status, 202);
    assert.deepEqual(published.map((p) => p.msg), [
        { event: "modify_sensitivity", mode: "high" },
        { event: "modify_window", window_days: 14 },
    ]);
    assert.ok(published.every((p) => p.topic === "sentinel/predictive/command" && p.opts.qos === 1 && p.opts.retain));
});

test("routes : retrain n'est JAMAIS retenu (sinon réapprentissage à chaque redémarrage de la brique)", async () => {
    published.length = 0;
    const res = await post("/retrain");
    assert.equal(res.status, 202);
    assert.deepEqual(published[0].msg, { event: "retrain" });
    assert.equal(published[0].opts.retain, false);
});

test("routes : un lecteur ne peut pas modifier les réglages", async () => {
    published.length = 0;
    assert.equal((await post("/config", { sensitivity: "low" }, "lecteur")).status, 403);
    assert.equal((await post("/retrain", {}, "lecteur")).status, 403);
    assert.equal(published.length, 0);
});

test("routes : configuration pas encore reçue de la brique -> 503", async () => {
    const res = await fetch(`${base}/config`, { headers: { Authorization: `Bearer ${token("lecteur")}` } });
    assert.equal(res.status, 503);
});
