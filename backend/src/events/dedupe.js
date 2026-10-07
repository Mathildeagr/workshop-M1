// Un même événement peut arriver deux fois : predict-anomalie publie sur le bus ET poste en HTTP
// (filet de sécurité, briefing §12.4), et le nœud rejoue sa file après une coupure (§6).

const TTL_MS = 5 * 60 * 1000;
const MAX_KEYS = 2000;

/** Clé d'identité d'un événement, ou null s'il n'a rien qui permette de le reconnaître. */
function eventKey(record) {
    const meta = record.meta ?? {};
    // Nœud : seq repart à zéro au démarrage, uptime_s le distingue d'un boot à l'autre
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
    const seen = new Map();   // clé -> date d'expiration

    /** Vrai si l'événement a déjà été vu récemment ; sinon le mémorise et renvoie faux. */
    return function isDuplicate(record) {
        const key = eventKey(record);
        if (!key) return false;
        const t = now();
        const expiry = seen.get(key);
        if (expiry && expiry > t) return true;
        seen.delete(key);              // réinsertion en fin de Map : l'ordre reste celui des expirations
        seen.set(key, t + TTL_MS);
        // Bornée en mémoire même sous un flood : on retire les plus anciennes (début de la Map)
        for (const k of seen.keys()) {
            if (seen.size <= MAX_KEYS && seen.get(k) > t) break;
            seen.delete(k);
        }
        return false;
    };
}

module.exports = { createDedupe, eventKey };
