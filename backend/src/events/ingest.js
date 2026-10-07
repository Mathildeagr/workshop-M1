// Pipeline unique de réception des événements, quel que soit le transport (MQTT ou POST /api/v1/alerts) :
// accusé de commande ? -> droits de l'émetteur -> enregistrement -> dashboard -> commande d'alarme.

const { toAlertRecord, formatAlert } = require("./alertRecord");
const { commandFor, isAllowed } = require("./rules");
const { createDedupe } = require("./dedupe");

class IngestError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/**
 * @param {object} deps  { Alert, Device, io, commands, alarmNode }
 */
function createIngest({ Alert, Device, io, commands, alarmNode, isDuplicate = createDedupe() }) {
    /**
     * @param {object} body     événement validé par alertSchema (champ "type", pas "event")
     * @param {string} emitter  identité de l'émetteur : clé d'appareil ou topic MQTT, jamais le corps
     * @param {object} [opts]   { ip } pour la route HTTP
     * @returns {Promise<{ kind: "ack"|"duplicate"|"created", alert?, command? }>}
     */
    return async function ingest(body, emitter, { ip } = {}) {
        // 1. Écho d'une commande : c'est un accusé d'exécution, pas un nouveau fait (briefing §5).
        //    Traité avant tout le reste : il porte un nom (intrusion_*, env_*) que le nœud n'émet pas lui-même.
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

        // 4. Enregistrement et diffusion
        const alert = await Alert.create(record);
        await Device.update({ lastSeen: new Date(), ...(ip ? { ip } : {}) }, { where: { id: emitter } });
        const payload = formatAlert(alert);
        io.emit("alert", payload);

        // 5. Alarme physique sur le boîtier
        const rule = commandFor(record, alarmNode);
        const sent = rule ? commands.send(rule.node, rule.command) : null;
        return {
            kind: "created",
            alert: payload,
            command: sent ? { id: sent.id, node: sent.node, event: sent.event } : null,
        };
    };
}

module.exports = { createIngest, IngestError };
