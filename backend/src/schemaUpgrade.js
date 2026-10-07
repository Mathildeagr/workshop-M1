const sequelize = require("./db");

// sequelize.sync() crée les tables manquantes mais ne modifie jamais une table existante.
// Ces instructions ajoutent les colonnes apparues après la création de la base.
// Idempotentes (IF NOT EXISTS) : sans effet sur une base neuve ou déjà à jour.
const STATEMENTS = [
    "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS emitter     VARCHAR(50)",
    "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS detail      VARCHAR(100)",
    "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS origin      VARCHAR(10)",
    "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS meta        JSONB",
    "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ",
];

async function upgradeSchema() {
    for (const sql of STATEMENTS) {
        await sequelize.query(sql);
    }
}

module.exports = upgradeSchema;
