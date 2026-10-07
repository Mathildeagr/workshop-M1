// Coupures de son / lumière demandées par le superviseur (activate / deactivate, briefing §4.2).
// Le nœud les oublie à chaque redémarrage : le backend les mémorise et les rejoue après node_boot.
// On garde la suite des ordres plutôt qu'un état calculé : la rejouer dans l'ordre reproduit exactement
// ce que le nœud avait appliqué, sans réimplémenter sa logique.

const MAX_PER_NODE = 20;

function isFullReset(cmd) {
    return cmd.event === "activate" && (cmd.target ?? "tout") === "tout" && (cmd.signal ?? "tous") === "tous";
}

function createSignalSettings() {
    const byNode = new Map();   // node -> [{ event, target, signal }]

    function record(node, cmd) {
        if (cmd.event !== "activate" && cmd.event !== "deactivate") return;
        const entry = { event: cmd.event, target: cmd.target ?? "tout", signal: cmd.signal ?? "tous" };
        if (isFullReset(entry)) {
            byNode.delete(node);   // tout réactivé : rien à rejouer, état de démarrage du nœud
            return;
        }
        // Un ordre sur la même cible et le même signal remplace le précédent
        const list = (byNode.get(node) ?? []).filter((c) => c.target !== entry.target || c.signal !== entry.signal);
        list.push(entry);
        byNode.set(node, list.slice(-MAX_PER_NODE));
    }

    /** Ordres à rejouer après un redémarrage du nœud, dans l'ordre où ils ont été donnés. */
    function toReplay(node) {
        return [...(byNode.get(node) ?? [])];
    }

    return { record, toReplay };
}

module.exports = { createSignalSettings };
