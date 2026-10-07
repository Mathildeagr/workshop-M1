// Alertes produites par le backend lui-même (et non reçues d'un appareil) :
// nœud hors ligne, événements perdus, commande non exécutée.
const { formatAlert } = require("./alertRecord");

function createSystemAlerts({ Alert, Device, io }) {
    /**
     * @param {object} alert  { deviceId, type, level, detail, value, emitter }
     * @returns {Promise<object|null>} l'alerte créée, ou null si le nœud est inconnu
     */
    return async function raise({ deviceId, type, level, detail = null, value = null, emitter = "backend" }) {
        if (!(await Device.findByPk(deviceId))) return null;   // clé étrangère : pas d'alerte sur un nœud inconnu
        const alert = await Alert.create({ deviceId, emitter, origin: emitter, type, level, detail, value });
        const payload = formatAlert(alert);
        io.emit("alert", payload);
        return payload;
    };
}

module.exports = { createSystemAlerts };
