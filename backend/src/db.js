const { Sequelize } = require("sequelize");
const config = require("./config");

const sequelize = new Sequelize(config.databaseUrl, {
    dialect: "postgres",
    logging: false,   // passe à console.log pour voir les requêtes SQL
});

module.exports = sequelize;
