// État des nœuds connus du bus : en ligne / hors ligne (testament MQTT) et dernière télémétrie.

// Champs de télémétrie relayés au dashboard (briefing §3.2) : on ne relaie rien d'autre
const TELEMETRY_FIELDS = [
    "uptime_s", "temperature_c", "humidity_pct", "dew_point_c", "climate_age_ms",
    "gas_raw", "gas_warming", "gas_ratio", "gas_age_ms",
    "presence", "presence_count", "tilt", "optic",
];

function pickTelemetry(body) {
    const out = {};
    for (const field of TELEMETRY_FIELDS) {
        const v = body[field];
        if (typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean" || (typeof v === "string" && v.length <= 12)) {
            out[field] = v;
        }
    }
    return out;
}

/**
 * @param {object} deps  { io, raiseAlert } : raiseAlert vient de events/systemAlerts.js
 */
function createNodeRegistry({ io, raiseAlert, now = Date.now }) {
    const nodes = new Map();   // id -> { status, statusAt, lastTelemetryAt }

    function get(id) {
        if (!nodes.has(id)) nodes.set(id, { status: "unknown", statusAt: null, lastTelemetryAt: null });
        return nodes.get(id);
    }

    /**
     * Topic sentinel/<id>/status : "online" ou "offline" (publié par le broker via le testament).
     * @param {boolean} retained  message retenu rejoué à l'abonnement : c'est l'état courant, pas un changement
     */
    async function handleStatus(id, status, retained) {
        if (status !== "online" && status !== "offline") return;
        const node = get(id);
        const previous = node.status;
        node.status = status;
        node.statusAt = now();
        io.emit("node_status", { node: id, status, at: new Date(node.statusAt).toISOString() });

        // Un nœud qui disparaît est un signal de sécurité (module arraché ou hors tension, §2), pas une info technique.
        // On ne crée l'alerte que sur un vrai changement en direct, pas au rejeu des messages retenus.
        // "online" n'est une alerte que s'il suit une coupure ("offline"), pas à la première connexion.
        const alarming = status === "offline" ? previous !== "offline" : previous === "offline";
        if (!alarming || retained) return;
        const physical = id.startsWith("esp");
        await raiseAlert({
            deviceId: id,
            emitter: "broker",
            type: status === "offline" ? "node_offline" : "node_online",
            level: status === "offline" ? (physical ? "critical" : "warning") : "info",
            detail: status === "offline" ? "connexion perdue (testament MQTT)" : "reconnecté au broker",
        });
    }

    function handleTelemetry(id, body) {
        const node = get(id);
        node.lastTelemetryAt = now();
        if (Number.isInteger(body.uptime_s)) node.lastUptime = body.uptime_s;
        io.emit("telemetry", { source: id, receivedAt: new Date(node.lastTelemetryAt).toISOString(), ...pickTelemetry(body) });
    }

    /**
     * uptime_s actuel estimé du nœud : dernier uptime reçu + temps écoulé depuis.
     * Null si la télémétrie est trop ancienne pour être fiable (nœud muet depuis plus d'une minute).
     */
    function estimateUptime(id, maxAgeMs = 60_000) {
        const node = nodes.get(id);
        if (!node?.lastTelemetryAt || node.lastUptime === undefined) return null;
        const age = now() - node.lastTelemetryAt;
        return age > maxAgeMs ? null : node.lastUptime + age / 1000;
    }

    function status(id) {
        return nodes.get(id) ?? null;
    }

    function list() {
        return [...nodes.entries()].map(([id, n]) => ({
            id,
            status: n.status,
            statusAt: n.statusAt && new Date(n.statusAt).toISOString(),
            lastTelemetryAt: n.lastTelemetryAt && new Date(n.lastTelemetryAt).toISOString(),
        }));
    }

    return { handleStatus, handleTelemetry, estimateUptime, status, list };
}

module.exports = { createNodeRegistry, pickTelemetry };
