const config = require("./config");   // en premier : charge et vérifie le .env
const express = require("express");
const http = require("http");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
const { sequelize, Role, User, Device, Alert, Command } = require("./models");
const upgradeSchema = require("./schemaUpgrade");
const { applySecurity, errorHandler, corsOptions } = require("./middleware/security");
const { verifyToken, requireUser } = require("./middleware/auth");
const authRouter = require("./routes/auth");
const usersRouter = require("./routes/users");
const alertsRouter = require("./routes/alerts");
const visionRouter = require("./routes/vision");
const facesRouter = require("./routes/faces");
const { createCommandPublisher } = require("./commands/publisher");
const { createIngest } = require("./events/ingest");
const { createNodeRegistry } = require("./nodes/registry");
const { createSystemAlerts } = require("./events/systemAlerts");
const { createSignalSettings } = require("./commands/signalSettings");
const commandsRouter = require("./routes/commands");
const predictiveRouter = require("./routes/predictive");
const { metricsRouter, readingsRouter } = require("./routes/readings");
const { createPredictiveState } = require("./predictive/state");
const { connectMqtt } = require("./mqtt/client");

let dbReady = false;
let mqttClient = null;

const app = express();
applySecurity(app);

const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions, maxHttpBufferSize: 1e4 });

// Seul un dashboard connecté (JWT valide) peut ouvrir le WebSocket
io.use((socket, next) => {
    const payload = verifyToken(socket.handshake.auth?.token);
    if (!payload) return next(new Error("Authentification requise"));
    socket.user = payload;
    next();
});

io.on("connection", (socket) => {
    console.log(`Dashboard connecté : ${socket.user.username} (${socket.id})`);
});

// Réception des événements (bus MQTT et route HTTP) -> base, dashboard, commandes d'alarme aux nœuds
const raiseAlert = createSystemAlerts({ Alert, Device, io });
const registry = createNodeRegistry({ io, raiseAlert });
const signalSettings = createSignalSettings();
const commands = createCommandPublisher({
    io,
    Command,
    ackTimeoutMs: config.commandAckTimeoutMs,
    nodeStatus: (node) => registry.status(node)?.status ?? "unknown",
    // Ordre non exécuté : l'alerte bascule sur le dashboard (§5). Pour un nœud hors ligne, node_offline suffit.
    onFailed: (cmd) => {
        if (cmd.failure === "node_offline") return;
        raiseAlert({
            deviceId: cmd.node, type: "command_failed", level: "warning", value: cmd.event,
            detail: `${cmd.event} (${cmd.id}) : ${cmd.reason}`,
        }).catch((err) => console.error("[commandes] alerte d'échec non créée :", err.message));
    },
});
const ingest = createIngest({
    Alert, Device, io, commands, signalSettings, raiseAlert,
    alarmNode: config.alarmNode,
    estimateUptime: registry.estimateUptime,
});
const predictive = createPredictiveState({ io });

// Route de test (publique, ne révèle rien de sensible)
app.get("/api/v1/health", (req, res) => {
    res.json({ status: "ok", db: dbReady ? "up" : "down", mqtt: mqttClient?.connected ? "up" : "down", ts: Date.now() });
});

// Comptes et alertes sont en base : réponse claire plutôt qu'une erreur 500 si elle est tombée
const requireDb = (req, res, next) =>
    dbReady ? next() : res.status(503).json({ error: "Base de données indisponible" });

app.use("/api/v1/auth", requireDb, authRouter);
app.use("/api/v1/users", requireDb, usersRouter);
app.use("/api/v1/alerts", requireDb, alertsRouter({ io, ingest }));
app.use("/api/v1/commands", requireDb, commandsRouter({ commands, signalSettings }));
// Mesures écrites par predict-anomalie : courbes en direct (metrics) et historique à la minute (readings)
app.use("/api/v1/metrics", requireDb, metricsRouter());
app.use("/api/v1/readings", requireDb, readingsRouter());
app.use("/api/v1/predictive", predictiveRouter({ state: predictive, getMqtt: () => mqttClient }));
// État des nœuds vus sur le bus (en ligne / hors ligne, dernière télémétrie)
app.get("/api/v1/nodes", requireUser, (req, res) => {
    res.json({ mqtt: mqttClient?.connected ?? false, nodes: registry.list() });
});
// Service vision (ai-vision/server.py) : pas besoin de la base, 503 si le service est absent
app.use("/api/v1/vision", visionRouter);
app.use("/api/v1/faces", facesRouter);

app.use((req, res) => res.status(404).json({ error: "Route inconnue" }));
app.use(errorHandler);

// Crée le premier admin à partir du .env si aucun admin n'existe
async function seedAdmin() {
    const { username, password } = config.admin;
    if (!username || !password) return;
    if (password.length < 12) {
        console.warn("ADMIN_PASSWORD trop court (12 caractères minimum) : admin non créé");
        return;
    }
    const adminRole = await Role.findOne({ where: { name: "admin" } });
    if (await User.count({ where: { roleId: adminRole.id } }) > 0) return;
    await User.create({ username, passwordHash: await bcrypt.hash(password, 12), roleId: adminRole.id });
    console.log(`Compte admin "${username}" créé`);
}

// Un Device par entrée de DEVICE_API_KEYS : nécessaire pour les clés étrangères des alertes et mesures
function deviceType(id) {
    if (id.startsWith("esp")) return "esp8266";
    if (id === "vision" || id === "predictive") return id;
    return "other";
}

async function seedDevices() {
    for (const id of config.deviceKeys.values()) {
        await Device.findOrCreate({ where: { id }, defaults: { name: id, type: deviceType(id) } });
    }
}

// Abonnement au bus : seulement une fois la base prête, sinon les événements reçus seraient perdus
function startMqtt() {
    if (!config.mqtt.username) {
        console.warn("MQTT_USERNAME absent : backend sans MQTT (alertes reçues par HTTP uniquement)");
        return;
    }
    mqttClient = connectMqtt({ ...config.mqtt, ingest, registry, predictive });
    commands.attach(mqttClient);
}

// Initialisation de la base
async function initDatabase() {
    try {
        await sequelize.authenticate();
        await sequelize.sync();   // crée les tables manquantes (ne modifie jamais une table existante)
        await upgradeSchema();    // ajoute les colonnes apparues depuis (tables déjà existantes)
        for (const name of ["admin", "superviseur", "lecteur"]) {
            await Role.findOrCreate({ where: { name } });
        }
        await seedAdmin();
        await seedDevices();
        dbReady = true;
        console.log("Base de données connectée");
        startMqtt();
    } catch (err) {
        console.warn("Base de données indisponible :", err.message || err.original?.code || err.name);
        console.warn("L'API démarre quand même (les routes qui utilisent la base répondent 503)");
    }
}

initDatabase().then(() => {
    server.listen(config.port, "0.0.0.0", () => {
        console.log(`API Sentinel-X sur le port ${config.port}`);
    });
});
