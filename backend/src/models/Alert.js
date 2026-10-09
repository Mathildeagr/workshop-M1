const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const Alert = sequelize.define("Alert", {
    type:           { type: DataTypes.STRING(50), allowNull: false },
    level:          { type: DataTypes.ENUM("info", "warning", "critical"), allowNull: false, defaultValue: "info" },
    value:          { type: DataTypes.JSONB },
    emitter:        { type: DataTypes.STRING(50) },
    detail:         { type: DataTypes.STRING(100) },
    origin:         { type: DataTypes.STRING(10) },
    meta:           { type: DataTypes.JSONB },
    occurredAt:     { type: DataTypes.DATE },
    acknowledged:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    acknowledgedAt: { type: DataTypes.DATE },
}, {
    tableName: "alerts",
    underscored: true,
    updatedAt: false,
    indexes: [{ fields: ["created_at"] }],
});

module.exports = Alert;
