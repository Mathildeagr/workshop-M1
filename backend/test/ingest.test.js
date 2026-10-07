const { test } = require("node:test");
const assert = require("node:assert/strict");
const { alertSchema } = require("../src/schemas");
const { commandFor, isAllowed } = require("../src/events/rules");
const { createDedupe } = require("../src/events/dedupe");
const { createIngest } = require("../src/events/ingest");
const { createCommandPublisher } = require("../src/commands/publisher");
const { createNodeRegistry } = require("../src/nodes/registry");
const { parseTopic, toAlertBody } = require("../src/mqtt/client");

// --- Fausses dépendances : aucune base ni broker ---------------------------------------------------
function fakes({ devices = ["esp01", "predictive", "vision"] } = {}) {
    const emitted = [];
    const published = [];
    const created = [];
    const io = { emit: (event, data) => emitted.push({ event, data }) };
    const mqtt = {
        connected: true,
        publish: (topic, message, opts) => published.push({ topic, message: JSON.parse(message), opts }),
    };
    let nextId = 1;
    const Alert = {
        create: async (record) => {
            const row = { id: nextId++, acknowledged: false, createdAt: new Date(), ...record };
            created.push(row);
            return row;
        },
    };
    const Device = {
        findByPk: async (id) => (devices.includes(id) ? { id } : null),
        update: async () => [1],
    };
    const commands = createCommandPublisher({ io });
    commands.attach(mqtt);
    const ingest = createIngest({ Alert, Device, io, commands, alarmNode: "esp01" });
    return { ingest, commands, emitted, published, created, Alert, Device, io };
}

const parse = (body) => alertSchema.parse(body);

// --- Règles -------------------------------------------------------------------------------------
test("règles : un événement de sabotage du nœud lui est renvoyé en commande", () => {
    assert.deepEqual(commandFor({ type: "tamper_opened", deviceId: "esp01", origin: "sensor" }, "esp01"),
        { node: "esp01", command: { event: "tamper_opened" } });
});

test("règles : env_* de predict-anomalie part vers le nœud concerné (source)", () => {
    assert.deepEqual(commandFor({ type: "env_critical", deviceId: "esp02", emitter: "predictive", origin: "model" }, "esp01"),
        { node: "esp02", command: { event: "env_critical" } });
});

test("règles : l'intrusion de la vision est traduite selon le statut et sonne sur le nœud d'alarme", () => {
    const rec = (status) => ({ type: "intrusion", deviceId: "vision", value: { status } });
    assert.equal(commandFor(rec("inconnu"), "esp01").command.event, "intrusion_unknown");
    assert.equal(commandFor(rec("non_identifie"), "esp01").command.event, "intrusion_unidentified");
    assert.equal(commandFor(rec("interdit"), "esp01").command.event, "intrusion_prohibited");
    assert.equal(commandFor(rec("interdit"), "esp01").node, "esp01");
    assert.equal(commandFor(rec("autorise"), "esp01"), null);
});

test("règles : jamais de commande pour un écho (origin command), ni pour un nom que le nœud ne joue pas", () => {
    assert.equal(commandFor({ type: "tamper_opened", deviceId: "esp01", origin: "command" }, "esp01"), null);
    assert.equal(commandFor({ type: "sensor_fault", deviceId: "esp01", origin: "sensor" }, "esp01"), null);
    assert.equal(commandFor({ type: "node_boot", deviceId: "esp01", origin: "sensor" }, "esp01"), null);
    assert.equal(commandFor({ type: "gas_leak", deviceId: "esp01" }, "esp01"), null);
});

test("règles : chaque émetteur ne parle que de sa famille", () => {
    assert.equal(isAllowed("tamper_opened", "esp01"), true);
    assert.equal(isAllowed("env_critical", "predictive"), true);
    assert.equal(isAllowed("intrusion", "vision"), true);
    assert.equal(isAllowed("env_critical", "vision"), false);
    assert.equal(isAllowed("env_critical", "esp01"), false);
    assert.equal(isAllowed("tamper_removed", "predictive"), false);
    assert.equal(isAllowed("intrusion_prohibited", "esp01"), false);
    assert.equal(isAllowed("gas_leak", "esp01"), true);   // hors familles connues : toléré, sans commande
});

// --- Anti-doublon ---------------------------------------------------------------------------------
test("anti-doublon : même seq et même uptime = doublon ; autre boot = nouvel événement", () => {
    const isDup = createDedupe();
    const rec = (seq, uptime_s) => ({ emitter: "esp01", type: "tamper_opened", meta: { seq, uptime_s } });
    assert.equal(isDup(rec(147, 412)), false);
    assert.equal(isDup(rec(147, 412)), true);
    assert.equal(isDup(rec(147, 3)), false);    // seq remis à zéro par un redémarrage
});

test("anti-doublon : un événement horodaté reçu par le bus puis en HTTP n'est gardé qu'une fois", () => {
    const isDup = createDedupe();
    const rec = { emitter: "predictive", type: "env_critical", deviceId: "esp01", occurredAt: new Date("2026-10-07T07:05:21Z") };
    assert.equal(isDup(rec), false);
    assert.equal(isDup({ ...rec }), true);
});

test("anti-doublon : sans seq ni horodatage, rien n'est dédoublonné", () => {
    const isDup = createDedupe();
    const rec = { emitter: "vision", type: "intrusion", meta: null, occurredAt: null };
    assert.equal(isDup(rec), false);
    assert.equal(isDup(rec), false);
});

// --- Pipeline ---------------------------------------------------------------------------------------
test("pipeline : tamper_opened du nœud -> alerte enregistrée, poussée au dashboard, commande QoS 1 avec id", async () => {
    const f = fakes();
    const result = await f.ingest(parse({ type: "tamper_opened", level: "warning", value: 3, detail: "objectif",
        origin: "sensor", seq: 147, uptime_s: 412 }), "esp01");

    assert.equal(result.kind, "created");
    assert.equal(f.created.length, 1);
    assert.ok(f.emitted.some((e) => e.event === "alert" && e.data.type === "tamper_opened"));
    assert.equal(f.published.length, 1);
    assert.equal(f.published[0].topic, "sentinel/esp01/command");
    assert.equal(f.published[0].message.event, "tamper_opened");
    assert.match(f.published[0].message.id, /^cmd-[0-9a-f]{8}$/);
    assert.equal(f.published[0].opts.qos, 1);
    assert.equal(result.command.id, f.published[0].message.id);
});

test("pipeline : l'écho origin command acquitte la commande, sans alerte ni nouvelle commande (pas de boucle)", async () => {
    const f = fakes();
    const first = await f.ingest(parse({ type: "tamper_opened", origin: "sensor", seq: 1, uptime_s: 10 }), "esp01");
    const echo = await f.ingest(parse({ type: "tamper_opened", origin: "command", cmd_id: first.command.id,
        seq: 2, uptime_s: 11 }), "esp01");

    assert.equal(echo.kind, "ack");
    assert.equal(echo.command.id, first.command.id);
    assert.equal(f.created.length, 1);       // l'écho n'est pas un nouvel événement
    assert.equal(f.published.length, 1);     // et ne repart jamais en commande
    assert.ok(f.emitted.some((e) => e.event === "command_status" && e.data.status === "acked"));
    assert.equal(f.commands.pending.size, 0);
});

test("pipeline : l'écho d'une commande intrusion_* venant du nœud est accepté (il n'est pas émis par le nœud)", async () => {
    const f = fakes();
    const sent = f.commands.send("esp01", { event: "intrusion_prohibited" });
    const echo = await f.ingest(parse({ type: "intrusion_prohibited", origin: "command", cmd_id: sent.id }), "esp01");
    assert.equal(echo.kind, "ack");
});

test("pipeline : env_critical de predict-anomalie concerne esp01 et y déclenche l'alarme", async () => {
    const f = fakes();
    const result = await f.ingest(parse({ type: "env_critical", level: "critical", origin: "model", source: "esp01",
        ts: "2026-10-07T07:05:21+00:00", score: 0.999 }), "predictive");
    assert.equal(result.alert.source, "esp01");
    assert.equal(result.alert.emitter, "predictive");
    assert.equal(f.published[0].topic, "sentinel/esp01/command");
});

test("pipeline : le même env_critical reçu par le bus puis en HTTP ne crée qu'une alerte", async () => {
    const f = fakes();
    const body = { type: "env_critical", origin: "model", source: "esp01", ts: "2026-10-07T07:05:21+00:00" };
    await f.ingest(parse(body), "predictive");
    const again = await f.ingest(parse(body), "predictive");
    assert.equal(again.kind, "duplicate");
    assert.equal(f.created.length, 1);
    assert.equal(f.published.length, 1);
});

test("pipeline : refuse une famille d'un autre émetteur, et un nœud inconnu", async () => {
    const f = fakes();
    await assert.rejects(f.ingest(parse({ type: "env_critical" }), "vision"), (e) => e.status === 403);
    await assert.rejects(f.ingest(parse({ type: "tamper_opened" }), "esp99"), (e) => e.status === 400);
    assert.equal(f.created.length, 0);
});

test("pipeline : broker injoignable -> alerte enregistrée quand même, commande signalée en échec", async () => {
    const f = fakes();
    f.commands.attach({ connected: false });
    const result = await f.ingest(parse({ type: "tamper_removed", origin: "sensor", seq: 5, uptime_s: 50 }), "esp01");
    assert.equal(result.kind, "created");
    assert.equal(result.command, null);
    assert.ok(f.emitted.some((e) => e.event === "command_status" && e.data.status === "failed"));
});

// --- Topics MQTT ----------------------------------------------------------------------------------
test("topics : l'identité du nœud vient du topic ; topics hors contrat ignorés", () => {
    assert.deepEqual(parseTopic("sentinel/esp01/events"), { node: "esp01", kind: "events" });
    assert.deepEqual(parseTopic("sentinel/predictive/status"), { node: "predictive", kind: "status" });
    assert.equal(parseTopic("sentinel/esp01/command"), null);
    assert.equal(parseTopic("sentinel/../events"), null);
    assert.equal(parseTopic("autre/esp01/events"), null);
});

test("trame du bus : event devient type, le reste est conservé", () => {
    assert.deepEqual(toAlertBody({ event: "tamper_opened", seq: 1 }), { type: "tamper_opened", seq: 1 });
    assert.equal(toAlertBody([1, 2]), null);
    assert.equal(toAlertBody("texte"), null);
});

// --- Statut des nœuds -------------------------------------------------------------------------------
test("statut : offline en direct après online -> alerte critique node_offline ; rejeu retenu -> aucune alerte", async () => {
    const f = fakes();
    const registry = createNodeRegistry({ Alert: f.Alert, Device: f.Device, io: f.io });
    await registry.handleStatus("esp01", "offline", true);   // état retenu rejoué à l'abonnement
    assert.equal(f.created.length, 0);
    await registry.handleStatus("esp01", "online", false);   // retour après coupure
    assert.equal(f.created.at(-1).type, "node_online");
    await registry.handleStatus("esp01", "offline", false);  // testament : module arraché
    assert.equal(f.created.at(-1).type, "node_offline");
    assert.equal(f.created.at(-1).level, "critical");
    await registry.handleStatus("esp01", "offline", false);  // répétition : pas de nouvelle alerte
    assert.equal(f.created.length, 2);
});

test("statut : première connexion d'un nœud -> pas d'alerte node_online", async () => {
    const f = fakes();
    const registry = createNodeRegistry({ Alert: f.Alert, Device: f.Device, io: f.io });
    await registry.handleStatus("esp01", "online", false);
    assert.equal(f.created.length, 0);
    assert.equal(registry.status("esp01").status, "online");
});
