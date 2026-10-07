// Abonnement au bus Mosquitto (briefing §7) et répartition des messages.
const mqtt = require("mqtt");
const { alertSchema } = require("../schemas");

const TOPIC_RE = /^sentinel\/([a-zA-Z0-9_-]{1,50})\/(events|status|telemetry|score|config)$/;
const MAX_PAYLOAD = 4096;   // le nœud envoie au plus 512 octets ; marge pour predict-anomalie
const PREDICTIVE = "predictive";

const SUBSCRIPTIONS = {
    "sentinel/+/events": { qos: 1 },      // QoS 1 : le broker garde les événements pendant un redémarrage du backend
    "sentinel/+/status": { qos: 1 },
    "sentinel/+/telemetry": { qos: 0 },   // remplacée toutes les 2 s : pas d'accusé (§2)
    "sentinel/predictive/score": { qos: 0 },    // score continu, toutes les 5 s (§9.7)
    "sentinel/predictive/config": { qos: 1 },   // configuration effective, retenue (§9.6)
};

/** sentinel/esp01/events -> { node: "esp01", kind: "events" }, ou null pour un topic hors contrat */
function parseTopic(topic) {
    const m = TOPIC_RE.exec(topic);
    if (!m) return null;
    // score et config n'existent que pour la brique predict-anomalie
    if ((m[2] === "score" || m[2] === "config") && m[1] !== PREDICTIVE) return null;
    return { node: m[1], kind: m[2] };
}

/** Trame "events" du bus -> corps attendu par alertSchema (le bus dit "event", l'API dit "type", §9.3). */
function toAlertBody(json) {
    if (!json || typeof json !== "object" || Array.isArray(json)) return null;
    const { event, ...rest } = json;
    return event === undefined ? rest : { type: event, ...rest };
}

/**
 * @param {object} opts  { url, username, password, ingest, registry, predictive }
 */
function connectMqtt({ url, username, password, ingest, registry, predictive }) {
    const client = mqtt.connect(url, {
        username,
        password,
        clientId: "sentinel-backend",
        clean: false,            // session persistante : les événements QoS 1 émis pendant une coupure sont gardés
        reconnectPeriod: 3000,
        connectTimeout: 5000,
    });

    client.on("connect", () => {
        console.log(`[mqtt] connecté à ${url}`);
        client.subscribe(SUBSCRIPTIONS, (err) => {
            if (err) console.error("[mqtt] abonnement impossible :", err.message);
        });
    });
    client.on("reconnect", () => console.log("[mqtt] reconnexion..."));
    client.on("error", (err) => console.error("[mqtt]", err.message));

    client.on("message", (topic, buffer, packet) => {
        const route = parseTopic(topic);
        if (!route || buffer.length > MAX_PAYLOAD) return;
        const text = buffer.toString("utf8");

        if (route.kind === "status") {
            registry.handleStatus(route.node, text.trim(), packet.retain)
                .catch((err) => console.error(`[mqtt] statut ${route.node} :`, err.message));
            return;
        }

        let json;
        try {
            json = JSON.parse(text);
        } catch {
            console.warn(`[mqtt] JSON invalide sur ${topic}`);
            return;
        }

        if (!json || typeof json !== "object" || Array.isArray(json)) return;
        if (route.kind === "telemetry") return registry.handleTelemetry(route.node, json);
        if (route.kind === "score") return predictive.handleScore(json);
        if (route.kind === "config") return predictive.handleConfig(json);

        // events : même validation que la route HTTP ; l'émetteur vient du topic, jamais du corps (§3.1)
        const parsed = alertSchema.safeParse(toAlertBody(json));
        if (!parsed.success) {
            const fields = parsed.error.issues.map((i) => i.path.join(".") || "(racine)").join(", ");
            console.warn(`[mqtt] événement refusé sur ${topic} (${fields})`);
            return;
        }
        ingest(parsed.data, route.node)
            .then((result) => {
                if (result.kind === "created" && result.command) {
                    console.log(`[mqtt] ${route.node} ${parsed.data.type} -> commande ${result.command.event} vers ${result.command.node}`);
                }
            })
            .catch((err) => console.warn(`[mqtt] événement ${route.node} ${parsed.data.type} non traité : ${err.message}`));
    });

    return client;
}

module.exports = { connectMqtt, parseTopic, toAlertBody };
