const { DataTypes } = require("sequelize");
const sequelize = require("../db");

// Événement ponctuel émis par l'ESP8266, l'IA vision ou l'IA prédictive
const Alert = sequelize.define("Alert", {
    type:           { type: DataTypes.STRING(50), allowNull: false },   // gas_leak, intrusion, anomaly...
    level:          { type: DataTypes.ENUM("info", "warning", "critical"), allowNull: false, defaultValue: "info" },
    value:          { type: DataTypes.JSONB },                          // 812, 0.91, { score: -0.3 }...
    acknowledged:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    acknowledgedAt: { type: DataTypes.DATE },
}, {
    tableName: "alerts",
    underscored: true,
    updatedAt: false,
    indexes: [{ fields: ["created_at"] }],
});

module.exports = Alert;
