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

    function pastOccurrence(record) {
        const uptime = record.meta?.uptime_s;
        if (record.occurredAt || uptime === undefined) return record.occurredAt;
        const current = estimateUptime(record.emitter);
        if (current === null || current < uptime) return null;
        const lagSeconds = current - uptime;
        return lagSeconds > 5 ? new Date(now() - lagSeconds * 1000) : null;
    }


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
        const gap = checkSequence(emitter, body.type, body.seq);
        if (gap) await reportGap(emitter, gap);

        if (body.origin === "command") {
            const command = commands.acknowledge(emitter, body.cmd_id);
            return { kind: "ack", command };
        }

        if (!isAllowed(body.type, emitter)) {
            throw new IngestError(403, `L'appareil ${emitter} ne peut pas émettre ${body.type}`);
        }

        const record = toAlertRecord(body, emitter);
        if (!(await Device.findByPk(record.deviceId))) {
            throw new IngestError(400, `Source inconnue : ${record.deviceId}`);
        }
        if (isDuplicate(record)) {
            return { kind: "duplicate" };
        }
        record.occurredAt = pastOccurrence(record);

        const alert = await Alert.create(record);
        await Device.update({ lastSeen: new Date(), ...(ip ? { ip } : {}) }, { where: { id: emitter } });
        const payload = formatAlert(alert);
        io.emit("alert", payload);

        let replayed = [];
        if (record.type === "node_boot") {
            replayed = signalSettings.toReplay(emitter).map((cmd) => commands.send(emitter, cmd, { trigger: "replay" }));
        }

        const rule = commandFor(record, alarmNode);
        const command = rule ? commands.send(rule.node, rule.command) : null;
        return { kind: "created", alert: payload, command, replayed };
    };
}

module.exports = { createIngest, IngestError };
