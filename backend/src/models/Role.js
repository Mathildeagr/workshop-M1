const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const Role = sequelize.define("Role", {
    name: { type: DataTypes.STRING(30), allowNull: false, unique: true },
}, {
    tableName: "roles",
    timestamps: false,
});

module.exports = Role;