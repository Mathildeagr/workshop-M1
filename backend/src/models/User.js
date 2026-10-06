const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const User = sequelize.define("User", {
    username:     { type: DataTypes.STRING(50), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false, field: "password_hash" },
}, {
    tableName: "users",
    underscored: true,   // created_at, role_id...
    updatedAt: false,
});

module.exports = User;