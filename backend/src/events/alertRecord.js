// Conversion d'un événement validé (alertSchema) en ligne de la table alerts.
// Fonction pure : partagée par POST /api/v1/alerts et, plus tard, par l'abonné MQTT.

// Émetteurs autorisés à parler POUR un autre nœud (champ "source") :
// predict-anomalie et la vision analysent les données d'un nœud sans être ce nœud.
// Un nœud physique (esp01) ne parle que pour lui-même.
const DELEGATING_EMITTERS = new Set(["predictive", "vision"]);

// Champs qui ont leur propre colonne ; tout le reste part dans meta
const COLUMNS = new Set(["type", "level", "value", "detail", "origin", "source", "ts"]);

class AlertRecordError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/**
 * @param {object} body     corps déjà validé par alertSchema
 * @param {string} emitter  identité de l'émetteur (clé d'appareil ou topic MQTT), jamais lue dans le corps
 * @returns {object} attributs pour Alert.create()
 */
function toAlertRecord(body, emitter) {
    const source = body.source ?? emitter;
    if (source !== emitter && !DELEGATING_EMITTERS.has(emitter)) {
        throw new AlertRecordError(403, `L'appareil ${emitter} ne peut pas émettre pour ${source}`);
    }

    const meta = {};
    for (const [key, val] of Object.entries(body)) {
        if (!COLUMNS.has(key)) meta[key] = val;
    }

    return {
        deviceId: source,
        emitter,
        type: body.type,
        level: body.level,
        value: body.value,
        detail: body.detail,
        origin: body.origin,
        occurredAt: body.ts ? new Date(body.ts) : null,
        meta: Object.keys(meta).length ? meta : null,
    };
}

// Format unique envoyé au dashboard (REST et Socket.io)
function formatAlert(alert) {
    return {
        id: alert.id,
        source: alert.deviceId,          // nœud concerné : c'est lui que le superviseur doit voir
        emitter: alert.emitter,          // qui a émis (esp01, predictive, vision)
        type: alert.type,
        level: alert.level,
        value: alert.value,
        detail: alert.detail,
        origin: alert.origin,
        meta: alert.meta,
        occurredAt: alert.occurredAt,
        acknowledged: alert.acknowledged,
        acknowledgedBy: alert.acknowledgedBy,
        acknowledgedAt: alert.acknowledgedAt,
        createdAt: alert.createdAt,
    };
}

module.exports = { toAlertRecord, formatAlert, AlertRecordError, DELEGATING_EMITTERS };
