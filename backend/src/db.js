const { Sequelize } = require("sequelize");

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,   // passe à console.log pour voir les requêtes SQL
});

module.exports = sequelize;