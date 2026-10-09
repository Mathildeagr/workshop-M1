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
            byNode.delete(node);
            return;
        }

        const list = (byNode.get(node) ?? []).filter((c) => c.target !== entry.target || c.signal !== entry.signal);
        list.push(entry);
        byNode.set(node, list.slice(-MAX_PER_NODE));
    }

    function toReplay(node) {
        return [...(byNode.get(node) ?? [])];
    }

    return { record, toReplay };
}

module.exports = { createSignalSettings };
