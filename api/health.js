const http = require("http");

function getToday() {
  const d = new Date(Date.now() - 3 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

module.exports = async function handler(req, res) {
  try {
    const check = await new Promise((resolve, reject) => {
      const r = http.get(
        { host: "191.246.88.18", port: 5000, path: `/ritux_logs/${getToday()}`, timeout: 8_000 },
        (resp) => {
          let data = "";
          resp.on("data", (c) => (data += c));
          resp.on("end", () => resolve({ status: resp.statusCode, hasLogs: data.includes(".log") }));
          resp.on("error", reject);
        }
      );
      r.on("error", reject);
      r.on("timeout", () => { r.destroy(); reject(new Error("timeout")); });
    });

    res.json({
      status: check.hasLogs ? "ok" : "no_logs",
      cameraReachable: true,
      httpStatus: check.status,
      today: getToday(),
    });
  } catch (e) {
    res.status(503).json({
      status: "camera_unreachable",
      cameraReachable: false,
      error: e.message,
      today: getToday(),
    });
  }
};
