const express = require("express");
const bcrypt = require("bcryptjs");
const { User, Role } = require("../models");
const { signToken, requireUser } = require("../middleware/auth");
const { loginLimiter } = require("../middleware/security");
const validate = require("../middleware/validate");
const { loginSchema } = require("../schemas");

const router = express.Router();

// Hash factice : un login avec un utilisateur inconnu prend le même temps qu'un mauvais mot de passe
const DUMMY_HASH = bcrypt.hashSync("sentinel-x-dummy-password", 12);

router.post("/login", loginLimiter, validate(loginSchema), async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username }, include: Role });
    const valid = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

    if (!user || !valid) {
        return res.status(401).json({ error: "Identifiants invalides" });
    }
    res.json({
        token: signToken(user, user.Role.name),
        user: { id: user.id, username: user.username, role: user.Role.name },
    });
});

router.get("/me", requireUser, (req, res) => {
    res.json({ id: req.user.sub, username: req.user.username, role: req.user.role });
});

module.exports = router;
