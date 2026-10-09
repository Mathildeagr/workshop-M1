const FAMILIES = [
    { name: "tamper", match: /^tamper_/, emitters: (e) => e.startsWith("esp") },
    { name: "node", match: /^(node_boot|sensor_fault|sensor_recovered)$/, emitters: (e) => e.startsWith("esp") },
    { name: "env", match: /^env_/, emitters: (e) => e === "predictive" },
    { name: "intrusion", match: /^intrusion(_|$)/, emitters: (e) => e === "vision" },
];

const PLAYABLE = new Set([
    "intrusion_unknown", "intrusion_unidentified", "intrusion_prohibited", "intrusion_cleared",
    "tamper_suspected", "tamper_opened", "tamper_removed", "tamper_cleared",
    "env_drift", "env_anomaly", "env_critical", "env_cleared",
]);

const INTRUSION_BY_STATUS = {
    inconnu: "intrusion_unknown",
    non_identifie: "intrusion_unidentified",
    interdit: "intrusion_prohibited",
};

function familyOf(type) {
    return FAMILIES.find((f) => f.match.test(type)) ?? null;
}

function isAllowed(type, emitter) {
    const family = familyOf(type);
    return !family || family.emitters(emitter);
}

/**
 * @param {object} record  ligne d'alerte (toAlertRecord) : type, deviceId, emitter, origin, value
 * @param {string} alarmNode  nœud qui sonne pour les émetteurs sans boîtier
 * @returns {{ node: string, command: { event: string } } | null}
 */
function commandFor(record, alarmNode) {
    if (record.origin === "command") return null;

    let event = record.type;
    let node = record.deviceId;
    if (event === "intrusion") {
        event = INTRUSION_BY_STATUS[record.value?.status] ?? null;
    }
    if (familyOf(record.type)?.name === "intrusion") {
        node = alarmNode;
    }
    if (!event || !PLAYABLE.has(event)) return null;
    return { node, command: { event } };
}

module.exports = { commandFor, isAllowed, familyOf, PLAYABLE };
