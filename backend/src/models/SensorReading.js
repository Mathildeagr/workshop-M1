const { DataTypes } = require("sequelize");
const sequelize = require("../db");

// Série temporelle : une ligne par envoi de l'ESP8266 (~toutes les 2 s)
const SensorReading = sequelize.define("SensorReading", {
    temperature: { type: DataTypes.FLOAT },
    humidity:    { type: DataTypes.FLOAT },
    gas:         { type: DataTypes.INTEGER },
    motion:      { type: DataTypes.BOOLEAN },
    measuredAt:  { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
    tableName: "sensor_readings",
    underscored: true,
    timestamps: false,

    indexes: [{ fields: ["device_id", "measured_at"] }],
});

module.exports = SensorReading;
