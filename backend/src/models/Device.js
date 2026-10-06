const { DataTypes } = require("sequelize");
const sequelize = require("../db");

// Une ligne par source de données : boîtier ESP8266 ou script IA
const Device = sequelize.define("Device", {
    id:       { type: DataTypes.STRING(50), primaryKey: true },   // même id que dans DEVICE_API_KEYS
    name:     { type: DataTypes.STRING(100), allowNull: false },
    type:     { type: DataTypes.ENUM("esp8266", "vision", "predictive", "other"), allowNull: false },
    ip:       { type: DataTypes.STRING(45) },                      // 45 = longueur max d'une IPv6
    lastSeen: { type: DataTypes.DATE },                            // null = jamais vu
}, {
    tableName: "devices",
    underscored: true,
    updatedAt: false,
});

module.exports = Device;
