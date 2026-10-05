const { DataTypes } = require("sequelize");
const sequelize = require("../db");

// Série temporelle : une ligne par envoi de l'ESP8266 (~toutes les 2 s)
const SensorReading = sequelize.define("SensorReading", {
    temperature: { type: DataTypes.FLOAT },     // DHT22, °C
    humidity:    { type: DataTypes.FLOAT },     // DHT22, %
    gas:         { type: DataTypes.INTEGER },   // MQ-2, valeur analogique 0-1023
    motion:      { type: DataTypes.BOOLEAN },   // PIR HC-SR501
    measuredAt:  { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
    tableName: "sensor_readings",
    underscored: true,
    timestamps: false,
    // Les requêtes sont toujours "un boîtier sur une période" : sans cet index elles ralentissent vite
    indexes: [{ fields: ["device_id", "measured_at"] }],
});

module.exports = SensorReading;
