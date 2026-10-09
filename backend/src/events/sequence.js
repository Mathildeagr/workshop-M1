function createSequenceTracker() {
    const lastSeq = new Map();

    /**
     * @returns {{ from: number, to: number, missing: number } | null} le trou détecté, ou null
     */
    return function check(node, type, seq) {
        if (!Number.isInteger(seq)) return null;
        const last = lastSeq.get(node);
        if (last === undefined || type === "node_boot") {
            lastSeq.set(node, seq);
            return null;
        }

        if (seq <= last) return null;
        lastSeq.set(node, seq);
        if (seq === last + 1) return null;
        return { from: last + 1, to: seq - 1, missing: seq - last - 1 };
    };
}

module.exports = { createSequenceTracker };
