const sequelize = require("../db");
const Role = require("./Role");
const User = require("./User");

Role.hasMany(User, { foreignKey: "roleId" });
User.belongsTo(Role, { foreignKey: "roleId" });

module.exports = { sequelize, Role, User };