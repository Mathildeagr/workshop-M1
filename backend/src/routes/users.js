const express = require("express");
const bcrypt = require("bcryptjs");
const { User, Role } = require("../models");
const { requireUser, requireRole } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { createUserSchema } = require("../schemas");

const router = express.Router();

// Gestion des comptes réservée aux admins
router.use(requireUser, requireRole("admin"));

router.get("/", async (req, res) => {
    const users = await User.findAll({
        attributes: ["id", "username", "createdAt"],
        include: { model: Role, attributes: ["name"] },
        order: [["id", "ASC"]],
    });
    res.json(users.map((u) => ({ id: u.id, username: u.username, role: u.Role.name, createdAt: u.createdAt })));
});

router.post("/", validate(createUserSchema), async (req, res) => {
    const { username, password, role } = req.body;
    if (await User.findOne({ where: { username } })) {
        return res.status(409).json({ error: "Nom d'utilisateur déjà pris" });
    }
    const roleRow = await Role.findOne({ where: { name: role } });
    const user = await User.create({
        username,
        passwordHash: await bcrypt.hash(password, 12),
        roleId: roleRow.id,
    });
    res.status(201).json({ id: user.id, username: user.username, role });
});

module.exports = router;
