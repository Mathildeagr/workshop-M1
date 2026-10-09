const { Readable } = require("stream");
const config = require("./config");

class VisionUnavailable extends Error {}

async function visionFetch(path, { method = "GET", headers = {}, body, timeoutMs = 10_000, signal } = {}) {
    if (!config.vision.token) {
        throw new VisionUnavailable("Service vision non configuré (VISION_SERVICE_TOKEN)");
    }
    const signals = [signal, timeoutMs ? AbortSignal.timeout(timeoutMs) : null].filter(Boolean);
    try {
        return await fetch(`${config.vision.url}${path}`, {
            method,
            headers: { ...headers, "X-Service-Token": config.vision.token },
            body,
            duplex: body instanceof Readable ? "half" : undefined,
            signal: signals.length ? AbortSignal.any(signals) : undefined,
        });
    } catch (err) {
        if (err.name === "TimeoutError") throw new VisionUnavailable("Service vision : délai dépassé");
        if (err.name === "AbortError") throw err;
        throw new VisionUnavailable("Service vision injoignable");
    }
}


async function forwardJson(upstream, res) {
    const text = await upstream.text();
    if (upstream.status === 204 || !text) return res.status(upstream.status).end();
    try {
        res.status(upstream.status).json(JSON.parse(text));
    } catch {
        res.status(502).json({ error: "Réponse invalide du service vision" });
    }
}

function sendError(err, res, next) {
    if (err instanceof VisionUnavailable) return res.status(503).json({ error: err.message });
    next(err);
}

module.exports = { visionFetch, forwardJson, sendError };
