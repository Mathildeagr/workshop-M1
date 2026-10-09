const TTL_MS = 5 * 60 * 1000;
const MAX_KEYS = 2000;

function eventKey(record) {
    const meta = record.meta ?? {};
    if (meta.seq !== undefined && meta.uptime_s !== undefined) {
        return `${record.emitter}|seq|${meta.uptime_s}|${meta.seq}|${record.type}`;
    }
    // Briques horodatées (predict-anomalie)
    if (record.occurredAt) {
        return `${record.emitter}|ts|${record.occurredAt.toISOString()}|${record.type}|${record.deviceId}`;
    }
    return null;
}

function createDedupe({ now = Date.now } = {}) {
    const seen = new Map();

    return function isDuplicate(record) {
        const key = eventKey(record);
        if (!key) return false;
        const t = now();
        const expiry = seen.get(key);
        if (expiry && expiry > t) return true;
        seen.delete(key);
        seen.set(key, t + TTL_MS);
        for (const k of seen.keys()) {
            if (seen.size <= MAX_KEYS && seen.get(k) > t) break;
            seen.delete(k);
        }
        return false;
    };
}

module.exports = { createDedupe, eventKey };
