const { DataTypes } = require("sequelize");
const sequelize = require("../db");

// Une ligne par source de données : boîtier ESP8266 ou script IA
const Device = sequelize.define("Device", {
    id:       { type: DataTypes.STRING(50), primaryKey: true },
    name:     { type: DataTypes.STRING(100), allowNull: false },
    type:     { type: DataTypes.ENUM("esp8266", "vision", "predictive", "other"), allowNull: false },
    ip:       { type: DataTypes.STRING(45) },
    lastSeen: { type: DataTypes.DATE },
}, {
    tableName: "devices",
    underscored: true,
    updatedAt: false,
});

module.exports = Device;
