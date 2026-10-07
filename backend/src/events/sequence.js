// Détection des événements perdus grâce au compteur seq du nœud (briefing §3.1) :
// seq augmente de 1 à chaque événement et repart à zéro au démarrage (node_boot).
// Un saut de 146 à 149 = deux événements jamais reçus : perte d'information de sécurité.

function createSequenceTracker() {
    const lastSeq = new Map();   // node -> dernier seq reçu

    /**
     * @returns {{ from: number, to: number, missing: number } | null} le trou détecté, ou null
     */
    return function check(node, type, seq) {
        if (!Number.isInteger(seq)) return null;
        const last = lastSeq.get(node);
        // Premier événement vu, ou redémarrage du nœud : nouveau point de départ
        if (last === undefined || type === "node_boot") {
            lastSeq.set(node, seq);
            return null;
        }
        // seq inférieur ou égal : événement rejoué en différé ou doublon, pas un trou (§6)
        if (seq <= last) return null;
        lastSeq.set(node, seq);
        if (seq === last + 1) return null;
        return { from: last + 1, to: seq - 1, missing: seq - last - 1 };
    };
}

module.exports = { createSequenceTracker };
