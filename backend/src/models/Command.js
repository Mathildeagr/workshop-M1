const { DataTypes } = require("sequelize");
const sequelize = require("../db");

// Trace de chaque ordre envoyé à un nœud : qui, quoi, quand, et s'il a été exécuté
const Command = sequelize.define("Command", {
    id:          { type: DataTypes.STRING(20), primaryKey: true },
    node:        { type: DataTypes.STRING(50), allowNull: false },
    event:       { type: DataTypes.STRING(50), allowNull: false },
    payload:     { type: DataTypes.JSONB, allowNull: false },
    trigger:     { type: DataTypes.STRING(10), allowNull: false },
    status:      { type: DataTypes.STRING(10), allowNull: false },
    attempts:    { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
    reason:      { type: DataTypes.STRING(100) },
    latencyMs:   { type: DataTypes.INTEGER },
    ackedAt:     { type: DataTypes.DATE },
}, {
    tableName: "commands",
    underscored: true,
    updatedAt: false,
    indexes: [{ fields: ["created_at"] }],
});

module.exports = Command;
