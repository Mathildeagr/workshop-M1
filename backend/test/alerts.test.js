const { test } = require("node:test");
const assert = require("node:assert/strict");
const { alertSchema } = require("../src/schemas");
const { toAlertRecord, AlertRecordError } = require("../src/events/alertRecord");

// Exemples tirés tels quels du briefing d'intégration (§3.1 et §9.3)
const ESP01_EVENT = {
    type: "tamper_opened", level: "warning", value: 3, detail: "objectif",
    origin: "sensor", seq: 147, uptime_s: 412,
};

const PREDICTIVE_EVENT = {
    type: "env_critical", level: "critical", detail: "temperature +49.3/h", value: 0.999,
    origin: "model", source: "esp01", ts: "2026-10-07T07:05:21+00:00", detector: "isolation-forest",
    score: 0.999, magnitude: 6.67, velocity: 4.66, jump: 0.7, sensitivity: "high",
    window_days: 30.0, effective_days: 29.994,
    rates: { temperature_slope: 49.3, humidity_slope: -58.6, gas_ratio_slope: 0.01, temperature_slope_long: 12.4 },
    contributions: { temperature_spread: 0.18, temperature_slope: 0.16, humidity_resid: 0.14 },
};

test("le schéma accepte l'événement du nœud esp01", () => {
    assert.equal(alertSchema.safeParse(ESP01_EVENT).success, true);
});

test("le schéma accepte l'événement de predict-anomalie", () => {
    assert.equal(alertSchema.safeParse(PREDICTIVE_EVENT).success, true);
});

test("le schéma accepte encore les anciennes alertes { type, level, value }", () => {
    assert.equal(alertSchema.safeParse({ type: "gas_leak", level: "critical", value: 812 }).success, true);
    assert.equal(alertSchema.safeParse({ type: "intrusion", value: { label: "inconnu", confidence: 0.9 } }).success, true);
});

test("le schéma reste strict : champ inconnu refusé", () => {
    assert.equal(alertSchema.safeParse({ ...ESP01_EVENT, pirate: 1 }).success, false);
});

test("le schéma refuse les valeurs hors contrat", () => {
    assert.equal(alertSchema.safeParse({ ...ESP01_EVENT, origin: "admin" }).success, false);
    assert.equal(alertSchema.safeParse({ ...PREDICTIVE_EVENT, score: 1.5 }).success, false);
    assert.equal(alertSchema.safeParse({ ...PREDICTIVE_EVENT, ts: "hier" }).success, false);
    assert.equal(alertSchema.safeParse({ ...ESP01_EVENT, seq: -1 }).success, false);
    assert.equal(alertSchema.safeParse({ ...ESP01_EVENT, source: "esp 01; DROP" }).success, false);
});

test("esp01 : le nœud concerné est l'émetteur, les champs techniques vont dans meta", () => {
    const record = toAlertRecord(alertSchema.parse(ESP01_EVENT), "esp01");
    assert.equal(record.deviceId, "esp01");
    assert.equal(record.emitter, "esp01");
    assert.equal(record.detail, "objectif");
    assert.equal(record.origin, "sensor");
    assert.equal(record.occurredAt, null);
    assert.deepEqual(record.meta, { seq: 147, uptime_s: 412 });
});

test("predictive : l'alerte concerne la source (esp01), l'émetteur reste predictive", () => {
    const record = toAlertRecord(alertSchema.parse(PREDICTIVE_EVENT), "predictive");
    assert.equal(record.deviceId, "esp01");
    assert.equal(record.emitter, "predictive");
    assert.equal(record.occurredAt.toISOString(), "2026-10-07T07:05:21.000Z");
    assert.deepEqual(record.meta.contributions, PREDICTIVE_EVENT.contributions);
    assert.equal(record.meta.score, 0.999);
    assert.equal("source" in record.meta, false);
    assert.equal("ts" in record.meta, false);
});

test("un nœud ne peut pas émettre pour un autre nœud (usurpation)", () => {
    assert.throws(
        () => toAlertRecord(alertSchema.parse({ ...ESP01_EVENT, source: "esp02" }), "esp01"),
        (err) => err instanceof AlertRecordError && err.status === 403,
    );
});

test("un nœud peut renseigner sa propre source", () => {
    assert.equal(toAlertRecord(alertSchema.parse({ ...ESP01_EVENT, source: "esp01" }), "esp01").deviceId, "esp01");
});

test("sans champ technique, meta est null", () => {
    assert.equal(toAlertRecord(alertSchema.parse({ type: "gas_leak" }), "esp01").meta, null);
});
