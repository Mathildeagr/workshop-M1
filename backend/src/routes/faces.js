const express = require("express");
const { requireUser, requireRole } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { faceNameSchema, faceStatusSchema, faceCaptureSchema } = require("../schemas");
const { visionFetch, forwardJson, sendError } = require("../visionClient");

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 + 64 * 1024;   // 5 Mo d'images (limite du service) + en-têtes multipart
const CAPTURE_TIMEOUT_MS = 60_000;                       // capture webcam : 30 s max côté service + chargement

const router = express.Router();

// Empreintes biométriques : consultation admin/superviseur, modifications admin uniquement
router.use(requireUser);
const canRead = requireRole("admin", "superviseur");
const canWrite = requireRole("admin");

function checkName(req, res, next) {
    if (!faceNameSchema.safeParse(req.params).success) {
        return res.status(400).json({ error: "Nom invalide" });
    }
    next();
}

router.get("/", canRead, async (req, res, next) => {
    try {
        await forwardJson(await visionFetch("/faces"), res);
    } catch (err) {
        sendError(err, res, next);
    }
});

// Enrôlement depuis des photos (multipart : name, status, image x10 max) : le body est relayé sans être
// mis en mémoire, le service Python vérifie les champs et qu'il y a exactement un visage par photo
router.post("/", canWrite, async (req, res, next) => {
    if (!req.is("multipart/form-data")) {
        return res.status(415).json({ error: "multipart/form-data attendu" });
    }
    const length = Number(req.get("content-length"));
    if (!length) {
        return res.status(411).json({ error: "Content-Length requis" });
    }
    if (length > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: "Fichier trop volumineux (5 Mo max)" });
    }
    try {
        const upstream = await visionFetch("/faces", {
            method: "POST",
            headers: { "Content-Type": req.get("content-type"), "Content-Length": String(length) },
            body: req,
            timeoutMs: 30_000,
        });
        await forwardJson(upstream, res);
    } catch (err) {
        sendError(err, res, next);
    }
});

// Enrôlement par la webcam (équivalent de "enroll.py add") : la vision est en pause pendant la capture,
// la réponse arrive une fois la capture terminée (aperçu visible sur /api/v1/vision/stream)
router.post("/capture", canWrite, validate(faceCaptureSchema), async (req, res, next) => {
    try {
        const upstream = await visionFetch("/faces/capture", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
            timeoutMs: CAPTURE_TIMEOUT_MS,
        });
        await forwardJson(upstream, res);
    } catch (err) {
        sendError(err, res, next);
    }
});

router.patch("/:name", canWrite, checkName, validate(faceStatusSchema), async (req, res, next) => {
    try {
        const upstream = await visionFetch(`/faces/${req.params.name}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
        });
        await forwardJson(upstream, res);
    } catch (err) {
        sendError(err, res, next);
    }
});

router.delete("/:name", canWrite, checkName, async (req, res, next) => {
    try {
        await forwardJson(await visionFetch(`/faces/${req.params.name}`, { method: "DELETE" }), res);
    } catch (err) {
        sendError(err, res, next);
    }
});

module.exports = router;
