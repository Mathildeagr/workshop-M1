const express = require("express");
const { Command, Device } = require("../models");
const { requireUser, requireRole } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { commandSchema, commandQuerySchema } = require("../schemas");

/**
 * Contrôle réactif du sujet : le superviseur déclenche une alarme ou coupe / rétablit les signaux d'un nœud.
 * @param {object} deps  { commands, signalSettings }
 */
module.exports = function commandsRouter({ commands, signalSettings }) {
    const router = express.Router();

    router.get("/", requireUser, async (req, res) => {
        const query = commandQuerySchema.safeParse(req.query);
        if (!query.success) {
            return res.status(400).json({ error: "Paramètres invalides" });
        }
        const { limit, node } = query.data;
        const rows = await Command.findAll({
            where: node ? { node } : {},
            order: [["createdAt", "DESC"]],
            limit,
        });
        res.json(rows);
    });

    router.post("/", requireUser, requireRole("admin", "superviseur"), validate(commandSchema), async (req, res) => {
        const { node, ...command } = req.body;
        const device = await Device.findByPk(node);
        if (!device || device.type !== "esp8266") {
            return res.status(404).json({ error: `Nœud inconnu : ${node}` });
        }

        const isSetting = command.event === "activate" || command.event === "deactivate";
        if (isSetting) signalSettings.record(node, command);

        const sent = commands.send(node, command, { trigger: "manual", issuedBy: Number(req.user.sub) });
        if (sent.status !== "failed") return res.status(202).json(sent);
        if (isSetting) return res.status(202).json({ ...sent, appliedAtNextBoot: true });
        res.status(503).json(sent);
    });

    return router;
};
