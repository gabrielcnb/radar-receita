function getToday() {
  const d = new Date(Date.now() - 3 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");

  try {
    const resp = await fetch(`http://191.246.88.18:5000/ritux_logs/${getToday()}`, { signal: AbortSignal.timeout(8_000) });
    const html = await resp.text();

    res.json({
      status: html.includes(".log") ? "ok" : "no_logs",
      cameraReachable: true,
      today: getToday(),
    });
  } catch (_) {
    res.status(503).json({
      status: "camera_unreachable",
      cameraReachable: false,
      today: getToday(),
    });
  }
};
