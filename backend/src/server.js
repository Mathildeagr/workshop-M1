require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { sequelize, Role } = require("./models");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Stockage temporaire en mémoire (remplacé plus tard par la table events)
const alerts = [];

// Route de test
app.get("/api/v1/health", (req, res) => {
    res.json({ status: "ok", db: dbReady ? "up" : "down", ts: Date.now() });
});

// Route obligatoire du sujet
app.post("/api/v1/alerts", (req, res) => {
    const { source, type, level, value } = req.body;
    if (!source || !type) {
        return res.status(400).json({ error: "source et type requis" });
    }
    const alert = { id: alerts.length + 1, source, type, level, value, ts: Date.now() };
    alerts.push(alert);
    io.emit("alert", alert);          // push instantané vers le dashboard
    res.status(201).json(alert);
});

app.get("/api/v1/alerts", (req, res) => {
    res.json(alerts);
});

io.on("connection", (socket) => {
    console.log("Dashboard connecté :", socket.id);
});

// Initialisation de la base
let dbReady = false;

async function initDatabase() {
    try {
        await sequelize.authenticate();
        await sequelize.sync();   // crée les tables roles et users si besoin
        for (const name of ["admin", "superviseur", "lecteur"]) {
            await Role.findOrCreate({ where: { name } });
        }
        dbReady = true;
        console.log("Base de données connectée");
    } catch (err) {
        console.warn("Base de données indisponible :", err.message);
        console.warn("L'API démarre quand même (alertes en mémoire uniquement)");
    }
}

const PORT = process.env.PORT || 3000;

initDatabase().then(() => {
    server.listen(PORT, "0.0.0.0", () => {
        console.log(`API Sentinel-X sur le port ${PORT}`);
    });
});