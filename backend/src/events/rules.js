// Règles d'alarme : à partir d'un événement enregistré, quelle commande envoyer à quel nœud.
// Le nœud ne décide rien (briefing §1) : même pour ses propres capteurs, c'est le backend qui lui
// ordonne de jouer une séquence. On envoie un NOM d'événement, jamais des durées ou fréquences (§4.1).

// Familles d'événements et émetteurs autorisés pour chacune (anti-usurpation : une clé "vision"
// volée ne doit pas pouvoir déclencher une alerte de gaz).
const FAMILIES = [
    { name: "tamper", match: /^tamper_/, emitters: (e) => e.startsWith("esp") },
    { name: "node", match: /^(node_boot|sensor_fault|sensor_recovered)$/, emitters: (e) => e.startsWith("esp") },
    { name: "env", match: /^env_/, emitters: (e) => e === "predictive" },
    { name: "intrusion", match: /^intrusion(_|$)/, emitters: (e) => e === "vision" },
];

// Noms que le nœud sait jouer (briefing §4.1) : tout le reste ne déclenche aucune commande
const PLAYABLE = new Set([
    "intrusion_unknown", "intrusion_unidentified", "intrusion_prohibited", "intrusion_cleared",
    "tamper_suspected", "tamper_opened", "tamper_removed", "tamper_cleared",
    "env_drift", "env_anomaly", "env_critical", "env_cleared",
]);

// Alerte "intrusion" de la vision : le statut du visage décide de la séquence
const INTRUSION_BY_STATUS = {
    inconnu: "intrusion_unknown",
    non_identifie: "intrusion_unidentified",
    interdit: "intrusion_prohibited",
};

function familyOf(type) {
    return FAMILIES.find((f) => f.match.test(type)) ?? null;
}

/** Vrai si l'émetteur a le droit d'émettre ce type. Types hors familles connues : autorisés (ex : gas_leak). */
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
    if (record.origin === "command") return null;   // accusé d'exécution : ne JAMAIS réémettre (§5)

    let event = record.type;
    let node = record.deviceId;
    if (event === "intrusion") {
        event = INTRUSION_BY_STATUS[record.value?.status] ?? null;
    }
    if (familyOf(record.type)?.name === "intrusion") {
        node = alarmNode;    // la vision n'a pas de buzzer : c'est le boîtier qui sonne
    }
    if (!event || !PLAYABLE.has(event)) return null;
    return { node, command: { event } };
}

module.exports = { commandFor, isAllowed, familyOf };
