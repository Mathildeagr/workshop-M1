const { DataTypes } = require("sequelize");
const sequelize = require("../db");

// Événement ponctuel émis par le nœud esp01, l'IA vision ou l'IA prédictive.
// deviceId = nœud CONCERNÉ (ce que voit le superviseur), emitter = qui a envoyé l'alerte.
// Ex : env_critical sur esp01 émis par predictive -> deviceId "esp01", emitter "predictive".
const Alert = sequelize.define("Alert", {
    type:           { type: DataTypes.STRING(50), allowNull: false },   // tamper_opened, env_drift, intrusion...
    level:          { type: DataTypes.ENUM("info", "warning", "critical"), allowNull: false, defaultValue: "info" },
    value:          { type: DataTypes.JSONB },                          // 3, 0.999, { label, status... }
    emitter:        { type: DataTypes.STRING(50) },                     // null sur les alertes antérieures
    detail:         { type: DataTypes.STRING(100) },                    // capteur à l'origine, ou explication
    origin:         { type: DataTypes.STRING(10) },                     // sensor | command | model
    meta:           { type: DataTypes.JSONB },                          // seq, uptime_s, score, contributions...
    occurredAt:     { type: DataTypes.DATE },                           // heure de l'émetteur ; createdAt = réception
    acknowledged:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    acknowledgedAt: { type: DataTypes.DATE },
}, {
    tableName: "alerts",
    underscored: true,
    updatedAt: false,
    indexes: [{ fields: ["created_at"] }],
});

module.exports = Alert;
