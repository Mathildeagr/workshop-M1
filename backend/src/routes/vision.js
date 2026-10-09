const express = require("express");
const { Readable } = require("stream");
const { requireUser, requireRole, signTicket, verifyTicket } = require("../middleware/auth");
const { visionFetch, forwardJson, sendError } = require("../visionClient");

const STREAM_PURPOSE = "vision-stream";

const router = express.Router();

router.get("/status", requireUser, async (req, res, next) => {
    try {
        await forwardJson(await visionFetch("/status"), res);
    } catch (err) {
        sendError(err, res, next);
    }
});

for (const action of ["start", "stop"]) {
    router.post(`/${action}`, requireUser, requireRole("admin", "superviseur"), async (req, res, next) => {
        try {
            await forwardJson(await visionFetch(`/${action}`, { method: "POST" }), res);
        } catch (err) {
            sendError(err, res, next);
        }
    });
}

router.post("/stream-ticket", requireUser, (req, res) => {
    const ticket = signTicket(req.user, STREAM_PURPOSE);
    res.json({ ticket, url: `/api/v1/vision/stream?ticket=${encodeURIComponent(ticket)}` });
});

router.get("/stream", async (req, res, next) => {
    if (!verifyTicket(String(req.query.ticket || ""), STREAM_PURPOSE)) {
        return res.status(401).json({ error: "Ticket invalide ou expiré" });
    }
    const abort = new AbortController();
    res.on("close", () => abort.abort());   // dashboard fermé : on coupe aussi la connexion au service
    try {
        const upstream = await visionFetch("/stream", { timeoutMs: 0, signal: abort.signal });
        if (!upstream.ok) return forwardJson(upstream, res);
        res.set({
            "Content-Type": upstream.headers.get("content-type"),
            "Cache-Control": "no-store",
        });
        Readable.fromWeb(upstream.body).on("error", () => res.end()).pipe(res);
    } catch (err) {
        if (err.name === "AbortError") return;
        sendError(err, res, next);
    }
});

module.exports = router;
