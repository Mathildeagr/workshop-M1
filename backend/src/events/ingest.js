// Pipeline unique de réception des événements, quel que soit le transport (MQTT ou POST /api/v1/alerts) :
// séquence -> accusé de commande ? -> droits de l'émetteur -> enregistrement -> dashboard -> commande d'alarme.

const { toAlertRecord, formatAlert } = require("./alertRecord");
const { commandFor, isAllowed } = require("./rules");
const { createDedupe } = require("./dedupe");
const { createSequenceTracker } = require("./sequence");

class IngestError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/**
 * @param {object} deps  { Alert, Device, io, commands, signalSettings, raiseAlert, alarmNode, estimateUptime }
 *   estimateUptime(node) : uptime_s actuel estimé du nœud (registre des nœuds), ou null
 */
function createIngest({
    Alert, Device, io, commands, signalSettings, raiseAlert, alarmNode, estimateUptime = () => null,
    isDuplicate = createDedupe(), checkSequence = createSequenceTracker(), now = Date.now,
}) {
    // Le nœud ne date pas ses messages (§6) : un événement rejoué après une coupure décrit un fait passé.
    // Instant réel ≈ réception − (uptime actuel − uptime du message). Seuil de 5 s pour ignorer la latence normale.
    function pastOccurrence(record) {
        const uptime = record.meta?.uptime_s;
        if (record.occurredAt || uptime === undefined) return record.occurredAt;
        const current = estimateUptime(record.emitter);
        if (current === null || current < uptime) return null;   // inconnu, ou message d'un boot plus récent
        const lagSeconds = current - uptime;
        return lagSeconds > 5 ? new Date(now() - lagSeconds * 1000) : null;
    }

    /** Trou dans seq : des événements du nœud ne sont jamais arrivés (§3.1). Signalé, sans bloquer l'événement. */
    async function reportGap(node, gap) {
        console.warn(`[sequence] ${node} : ${gap.missing} événement(s) perdu(s) (seq ${gap.from} à ${gap.to})`);
        io.emit("seq_gap", { node, ...gap });
        await raiseAlert({
            deviceId: node, type: "seq_gap", level: "warning", value: gap.missing,
            detail: gap.missing === 1 ? `événement seq ${gap.from} perdu` : `événements seq ${gap.from} à ${gap.to} perdus`,
        });
    }

    /**
     * @param {object} body     événement validé par alertSchema (champ "type", pas "event")
     * @param {string} emitter  identité de l'émetteur : clé d'appareil ou topic MQTT, jamais le corps
     * @param {object} [opts]   { ip } pour la route HTTP
     * @returns {Promise<{ kind: "ack"|"duplicate"|"created", alert?, command?, replayed? }>}
     */
    return async function ingest(body, emitter, { ip } = {}) {
        // 0. Séquence : les échos de commande incrémentent aussi seq, on les compte donc avant tout tri
        const gap = checkSequence(emitter, body.type, body.seq);
        if (gap) await reportGap(emitter, gap);

        // 1. Écho d'une commande : c'est un accusé d'exécution, pas un nouveau fait (briefing §5).
        //    Traité avant les droits : il porte un nom (intrusion_*, env_*) que le nœud n'émet pas lui-même.
        if (body.origin === "command") {
            const command = commands.acknowledge(emitter, body.cmd_id);
            return { kind: "ack", command };
        }

        // 2. Chaque émetteur ne parle que de sa famille d'événements
        if (!isAllowed(body.type, emitter)) {
            throw new IngestError(403, `L'appareil ${emitter} ne peut pas émettre ${body.type}`);
        }

        // 3. Nœud concerné (peut différer de l'émetteur pour predict-anomalie et la vision)
        const record = toAlertRecord(body, emitter);
        if (!(await Device.findByPk(record.deviceId))) {
            throw new IngestError(400, `Source inconnue : ${record.deviceId}`);
        }
        if (isDuplicate(record)) {
            return { kind: "duplicate" };
        }
        record.occurredAt = pastOccurrence(record);

        // 4. Enregistrement et diffusion
        const alert = await Alert.create(record);
        await Device.update({ lastSeen: new Date(), ...(ip ? { ip } : {}) }, { where: { id: emitter } });
        const payload = formatAlert(alert);
        io.emit("alert", payload);

        // 5. Redémarrage du nœud : il a oublié les coupures de son et de lumière, on les lui renvoie (§4.2)
        let replayed = [];
        if (record.type === "node_boot") {
            replayed = signalSettings.toReplay(emitter).map((cmd) => commands.send(emitter, cmd, { trigger: "replay" }));
        }

        // 6. Alarme physique sur le boîtier
        const rule = commandFor(record, alarmNode);
        const command = rule ? commands.send(rule.node, rule.command) : null;
        return { kind: "created", alert: payload, command, replayed };
    };
}

module.exports = { createIngest, IngestError };
