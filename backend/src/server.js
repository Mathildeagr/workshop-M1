const config = require("./config");   // en premier : charge et vérifie le .env
const express = require("express");
const http = require("http");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
const { sequelize, Role, User } = require("./models");
const { applySecurity, errorHandler, corsOptions } = require("./middleware/security");
const { verifyToken } = require("./middleware/auth");
const authRouter = require("./routes/auth");
const usersRouter = require("./routes/users");
const alertsRouter = require("./routes/alerts");

let dbReady = false;

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

// Route de test (publique, ne révèle rien de sensible)
app.get("/api/v1/health", (req, res) => {
    res.json({ status: "ok", db: dbReady ? "up" : "down", ts: Date.now() });
});

// Les comptes sont en base : réponse claire plutôt qu'une erreur 500 si elle est tombée
const requireDb = (req, res, next) =>
    dbReady ? next() : res.status(503).json({ error: "Base de données indisponible" });

app.use("/api/v1/auth", requireDb, authRouter);
app.use("/api/v1/users", requireDb, usersRouter);
app.use("/api/v1/alerts", alertsRouter(io));

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

// Initialisation de la base
async function initDatabase() {
    try {
        await sequelize.authenticate();
        await sequelize.sync();   // crée les tables roles et users si besoin
        for (const name of ["admin", "superviseur", "lecteur"]) {
            await Role.findOrCreate({ where: { name } });
        }
        await seedAdmin();
        dbReady = true;
        console.log("Base de données connectée");
    } catch (err) {
        console.warn("Base de données indisponible :", err.message || err.original?.code || err.name);
        console.warn("L'API démarre quand même (alertes en mémoire uniquement)");
    }
}

initDatabase().then(() => {
    server.listen(config.port, "0.0.0.0", () => {
        console.log(`API Sentinel-X sur le port ${config.port}`);
    });
});
