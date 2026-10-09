const IDENTIFIER = /^[a-zA-Z0-9_-]{1,50}$/;
const STAGES = new Set(["normal", "drift", "anomaly", "critical"]);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v, max = 20) => (typeof v === "string" && v.length <= max ? v : undefined);

/** Ne garde que les champs connus et bien typés : le dashboard ne reçoit rien d'autre que le contrat. */
function pickConfig(body) {
    return {
        sensitivity: ["low", "medium", "high"].includes(body.sensitivity) ? body.sensitivity : undefined,
        window_days: num(body.window_days),
        effective_days: num(body.effective_days),
        drift_quantile: num(body.drift_quantile),
        magnitude_ratio: num(body.magnitude_ratio),
        velocity_ratio: num(body.velocity_ratio),
        persistence: num(body.persistence),
    };
}

function pickScore(body) {
    if (typeof body.source !== "string" || !IDENTIFIER.test(body.source)) return null;
    return {
        source: body.source,
        ts: str(body.ts, 40),
        stage: STAGES.has(body.stage) ? body.stage : str(body.stage),
        score: num(body.score),
        magnitude: num(body.magnitude),
        velocity: num(body.velocity),
        sensitivity: str(body.sensitivity),
        window_days: num(body.window_days),
    };
}

function createPredictiveState({ io, now = Date.now }) {
    let config = null;
    const scores = new Map();

    function handleConfig(body) {
        config = { ...pickConfig(body), receivedAt: new Date(now()).toISOString() };
        io.emit("predictive_config", config);
    }

    function handleScore(body) {
        const score = pickScore(body);
        if (!score) return;
        scores.set(score.source, score);
        io.emit("score", score);
    }

    return {
        handleConfig,
        handleScore,
        config: () => config,
        scores: () => [...scores.values()],
    };
}

module.exports = { createPredictiveState, pickConfig, pickScore };
