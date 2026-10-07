const sequelize = require("../db");
const Role = require("./Role");
const User = require("./User");
const Device = require("./Device");
const SensorReading = require("./SensorReading");
const Alert = require("./Alert");
const Command = require("./Command");

Role.hasMany(User, { foreignKey: "roleId" });
User.belongsTo(Role, { foreignKey: "roleId" });

Device.hasMany(SensorReading, { foreignKey: { name: "deviceId", allowNull: false }, onDelete: "CASCADE" });
SensorReading.belongsTo(Device, { foreignKey: { name: "deviceId", allowNull: false } });

Device.hasMany(Alert, { foreignKey: { name: "deviceId", allowNull: false }, onDelete: "CASCADE" });
Alert.belongsTo(Device, { foreignKey: { name: "deviceId", allowNull: false } });

// Qui a acquitté l'alerte (null tant qu'elle ne l'est pas)
User.hasMany(Alert, { foreignKey: "acknowledgedBy", onDelete: "SET NULL" });
Alert.belongsTo(User, { as: "acknowledger", foreignKey: "acknowledgedBy" });

// Superviseur à l'origine d'une commande manuelle (null pour les commandes automatiques)
User.hasMany(Command, { foreignKey: "issuedBy", onDelete: "SET NULL" });
Command.belongsTo(User, { as: "issuer", foreignKey: "issuedBy" });

module.exports = { sequelize, Role, User, Device, SensorReading, Alert, Command };
