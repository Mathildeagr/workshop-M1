const crypto = require("crypto");

// Envoi des commandes aux nœuds et suivi de leur accusé d'exécution (briefing §5) :
// chaque commande porte un id, le nœud le renvoie dans cmd_id sur son topic events (origin "command").
// Phase suivante : délai de 2 s, retentes et abandon explicite.

function createCommandPublisher({ io, now = Date.now }) {
    let mqtt = null;             // client branché après la connexion à la base (attach)
    const pending = new Map();   // id -> { id, node, event, sentAt }

    function emitStatus(cmd, status, extra = {}) {
        io.emit("command_status", { id: cmd.id, node: cmd.node, event: cmd.event, status, ...extra });
    }

    /**
     * Publie une commande en QoS 1 : le broker la garde pour un nœud momentanément absent
     * (session persistante), alors qu'en QoS 0 elle serait perdue (§2).
     * @returns {object|null} la commande envoyée, ou null si MQTT n'est pas connecté
     */
    function send(node, command) {
        const cmd = { id: `cmd-${crypto.randomBytes(4).toString("hex")}`, node, event: command.event, sentAt: now() };
        if (!mqtt?.connected) {
            emitStatus(cmd, "failed", { reason: "broker injoignable" });
            return null;
        }
        mqtt.publish(`sentinel/${node}/command`, JSON.stringify({ ...command, id: cmd.id }), { qos: 1 });
        // Sans accusé au bout d'une minute, on oublie la commande : mémoire bornée même si le nœud ne répond jamais
        for (const [id, old] of pending) {
            if (cmd.sentAt - old.sentAt < 60_000) break;
            pending.delete(id);
        }
        pending.set(cmd.id, cmd);
        emitStatus(cmd, "sent");
        return cmd;
    }

    /** Écho origin "command" reçu du nœud : la commande a été exécutée. */
    function acknowledge(node, cmdId) {
        const cmd = cmdId ? pending.get(cmdId) : null;
        if (!cmd || cmd.node !== node) {
            console.log(`[commandes] accusé sans commande connue : ${node} ${cmdId ?? "(sans id)"}`);
            return null;
        }
        pending.delete(cmdId);
        emitStatus(cmd, "acked", { latencyMs: now() - cmd.sentAt });
        return cmd;
    }

    function attach(client) {
        mqtt = client;
    }

    return { send, acknowledge, attach, pending };
}

module.exports = { createCommandPublisher };
