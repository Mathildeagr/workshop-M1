const DELEGATING_EMITTERS = new Set(["predictive", "vision"]);

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
        source: alert.deviceId,
        emitter: alert.emitter,
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
