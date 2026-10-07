const { DataTypes } = require("sequelize");
const sequelize = require("../db");

// Trace de chaque ordre envoyé à un nœud : qui, quoi, quand, et s'il a été exécuté (briefing §5).
const Command = sequelize.define("Command", {
    id:          { type: DataTypes.STRING(20), primaryKey: true },        // cmd-8f3a12bc, renvoyé par le nœud dans cmd_id
    node:        { type: DataTypes.STRING(50), allowNull: false },
    event:       { type: DataTypes.STRING(50), allowNull: false },        // tamper_opened, deactivate...
    payload:     { type: DataTypes.JSONB, allowNull: false },             // corps publié sur sentinel/<node>/command
    trigger:     { type: DataTypes.STRING(10), allowNull: false },        // rule (alerte reçue) | manual | replay (après node_boot)
    status:      { type: DataTypes.STRING(10), allowNull: false },        // sent | retrying | acked | failed
    attempts:    { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
    reason:      { type: DataTypes.STRING(100) },                         // cause d'un échec
    latencyMs:   { type: DataTypes.INTEGER },                             // envoi -> accusé
    ackedAt:     { type: DataTypes.DATE },
}, {
    tableName: "commands",
    underscored: true,
    updatedAt: false,
    indexes: [{ fields: ["created_at"] }],
});

module.exports = Command;
