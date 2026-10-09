const crypto = require("crypto");

const ACK_TIMEOUT_MS = 2000;
const MAX_ATTEMPTS = 3;

/**
 * @param {object} deps
 *   io          Socket.io (command_status)
 *   Command     modèle Sequelize (trace en base), facultatif dans les tests
 *   nodeStatus  (node) => "online" | "offline" | "unknown"
 *   onFailed    (cmd) => void : l'alerte bascule sur un autre canal (dashboard) quand le nœud est injoignable
 */
function createCommandPublisher({
    io, Command = null, nodeStatus = () => "unknown", onFailed = () => {},
    now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
    ackTimeoutMs = ACK_TIMEOUT_MS, maxAttempts = MAX_ATTEMPTS,
}) {
    let mqtt = null;
    const pending = new Map();

    function view(cmd) {
        return {
            id: cmd.id, node: cmd.node, event: cmd.event, trigger: cmd.trigger, status: cmd.status,
            attempts: cmd.attempts, maxAttempts, reason: cmd.reason ?? null, failure: cmd.failure ?? null, latencyMs: cmd.latencyMs ?? null,
        };
    }

    function update(cmd, changes) {
        Object.assign(cmd, changes);
        io.emit("command_status", view(cmd));
        if (Command) {
            Command.upsert({
                id: cmd.id, node: cmd.node, event: cmd.event, payload: cmd.payload, trigger: cmd.trigger,
                issuedBy: cmd.issuedBy, status: cmd.status, attempts: cmd.attempts, reason: cmd.reason ?? null,
                latencyMs: cmd.latencyMs ?? null, ackedAt: cmd.ackedAt ?? null,
            }).catch((err) => console.error(`[commandes] trace ${cmd.id} non enregistrée :`, err.message));
        }
    }

    /** @param {"node_offline"|"no_ack"|"broker_down"} failure  cause, lisible par programme */
    function fail(cmd, failure, reason) {
        pending.delete(cmd.id);
        if (cmd.timer) clearTimer(cmd.timer);
        update(cmd, { status: "failed", failure, reason, timer: null });
        console.warn(`[commandes] ${cmd.id} ${cmd.event} -> ${cmd.node} abandonnée : ${reason}`);
        onFailed(view(cmd));
    }

    function attempt(cmd) {
        if (!mqtt?.connected) return fail(cmd, "broker_down", "broker injoignable");
        mqtt.publish(`sentinel/${cmd.node}/command`, JSON.stringify(cmd.payload), { qos: 1 });
        const attempts = cmd.attempts + 1;
        update(cmd, { attempts, status: attempts === 1 ? "sent" : "retrying" });
        cmd.timer = setTimer(() => onTimeout(cmd.id), ackTimeoutMs);
    }

    function onTimeout(id) {
        const cmd = pending.get(id);
        if (!cmd) return;
        cmd.timer = null;
        if (nodeStatus(cmd.node) === "offline") return fail(cmd, "node_offline", "nœud hors ligne");
        if (cmd.attempts >= maxAttempts) return fail(cmd, "no_ack", `aucun accusé après ${maxAttempts} tentatives`);
        attempt(cmd);   // même id : un accusé tardif de la tentative précédente reste reconnu
    }

    /**
     * @param {string} node
     * @param {object} command  { event, ...champs } publié tel quel, plus l'id
     * @param {object} [opts]   { trigger: "rule" | "manual" | "replay", issuedBy: id utilisateur }
     * @returns {object} vue de la commande (status "sent" ou "failed")
     */
    function send(node, command, { trigger = "rule", issuedBy = null } = {}) {
        const id = `cmd-${crypto.randomBytes(4).toString("hex")}`;
        const cmd = {
            id, node, event: command.event, payload: { ...command, id }, trigger, issuedBy,
            attempts: 0, status: "pending", sentAt: now(), timer: null,
        };
        pending.set(id, cmd);

        if (nodeStatus(node) === "offline") {
            fail(cmd, "node_offline", "nœud hors ligne");
        } else {
            attempt(cmd);
        }
        return view(cmd);
    }

    function acknowledge(node, cmdId) {
        const cmd = cmdId ? pending.get(cmdId) : null;
        if (!cmd || cmd.node !== node) {
            console.log(`[commandes] accusé sans commande en attente : ${node} ${cmdId ?? "(sans id)"}`);
            return null;
        }
        pending.delete(cmdId);
        if (cmd.timer) clearTimer(cmd.timer);
        update(cmd, { status: "acked", latencyMs: now() - cmd.sentAt, ackedAt: new Date(now()), timer: null });
        return view(cmd);
    }

    function attach(client) {
        mqtt = client;
    }

    return { send, acknowledge, attach, pending };
}

module.exports = { createCommandPublisher, ACK_TIMEOUT_MS, MAX_ATTEMPTS };
