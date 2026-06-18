const http = require("http");

const CAMERA_HOST = "191.246.88.18";
const CAMERA_PORT = 5000;
const SPEED_LIMIT = 50;
const TOLERANCE = 7;

const FINES = {
  speed_20: 130.16,
  speed_50: 195.23,
  speed_50_plus: 880.41,
  red_light: 293.47,
};

function getToday() {
  const d = new Date(Date.now() - 3 * 3600_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fetchAvailableLogs(datePath) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: CAMERA_HOST, port: CAMERA_PORT, path: `/ritux_logs/${datePath}`, timeout: 10_000, insecureHTTPParser: true },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const html = Buffer.concat(chunks).toString("utf-8");
          const files = [];
          const re = /download_ritux_log\/[^/]+\/([^"]+\.log)/g;
          let m;
          while ((m = re.exec(html))) files.push(m[1]);
          resolve(files);
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function fetchLog(datePath, logFile) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: CAMERA_HOST, port: CAMERA_PORT, path: `/download_ritux_log/${datePath}/${logFile}`, timeout: 20_000, insecureHTTPParser: true },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function processLog(raw) {
  const lines = raw.split("\n");
  let totalVehicles = 0;
  let speedTotal = 0;
  let maxSpeed = 0;
  let redLightCycles = 0;
  const profiles = {};
  const lanes = {};
  const speedViolations = { up20: 0, up50: 0, over50: 0 };
  const vehiclesPerHour = {};
  const recentFeed = [];

  const velRe = /(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\.\d+)[^:]*: (\d+) - F:(\d+) Vel:(\d+)km\/h - Tam:([\d.]+) - Perfil: (\w+)/;

  for (const line of lines) {
    const velMatch = line.match(velRe);
    if (velMatch) {
      const speed = parseInt(velMatch[4]);
      const lane = parseInt(velMatch[3]);
      const profile = velMatch[6];
      const timestamp = velMatch[1];

      totalVehicles++;
      speedTotal += speed;
      if (speed > maxSpeed) maxSpeed = speed;
      profiles[profile] = (profiles[profile] || 0) + 1;
      lanes[lane] = (lanes[lane] || 0) + 1;

      const considered = speed - TOLERANCE;
      if (considered > SPEED_LIMIT) {
        const pct = ((considered - SPEED_LIMIT) / SPEED_LIMIT) * 100;
        if (pct > 50) speedViolations.over50++;
        else if (pct > 20) speedViolations.up50++;
        else speedViolations.up20++;
      }

      const hourMatch = timestamp.match(/(\d{2}):\d{2}:\d{2}/);
      if (hourMatch) {
        vehiclesPerHour[hourMatch[1]] = (vehiclesPerHour[hourMatch[1]] || 0) + 1;
      }

      const time = timestamp.split(" ")[1]?.split(".")[0] || "";
      let violation = null;
      if (considered > SPEED_LIMIT) {
        const pct = ((considered - SPEED_LIMIT) / SPEED_LIMIT) * 100;
        if (pct > 50) violation = ">50%";
        else if (pct > 20) violation = "20-50%";
        else violation = "<20%";
      }
      recentFeed.push({ time, lane, speed, profile, size: parseFloat(velMatch[5]), violation });
      continue;
    }

    if (line.includes("Multando!")) redLightCycles++;
  }

  const totalSpeedFines =
    speedViolations.up20 * FINES.speed_20 +
    speedViolations.up50 * FINES.speed_50 +
    speedViolations.over50 * FINES.speed_50_plus;
  const totalRedFines = redLightCycles * FINES.red_light * 0.15;

  return {
    today: getToday(),
    lastScrape: new Date().toISOString(),
    lastError: null,
    stats: {
      totalVehicles,
      profiles,
      lanes,
      speedViolations,
      redLightCycles,
      estimatedRevenue: Math.round((totalSpeedFines + totalRedFines) * 100) / 100,
      avgSpeed: totalVehicles > 0 ? Math.round((speedTotal / totalVehicles) * 10) / 10 : 0,
      maxSpeed,
      vehiclesPerHour,
    },
    recentFeed: recentFeed.slice(-30).reverse(),
    fines: FINES,
    speedLimit: SPEED_LIMIT,
    tolerance: TOLERANCE,
  };
}

module.exports = async function handler(req, res) {
  try {
    const today = getToday();
    const logs = await fetchAvailableLogs(today);
    const mainLog = logs[0] || "rl001008.log";
    const raw = await fetchLog(today, mainLog);
    const result = processLog(raw);
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.json(result);
  } catch (e) {
    res.status(502).json({
      today: getToday(),
      lastScrape: null,
      lastError: e.message,
      stats: { totalVehicles: 0, profiles: {}, lanes: {}, speedViolations: { up20: 0, up50: 0, over50: 0 }, redLightCycles: 0, estimatedRevenue: 0, avgSpeed: 0, maxSpeed: 0, vehiclesPerHour: {} },
      recentFeed: [],
      fines: FINES,
      speedLimit: SPEED_LIMIT,
      tolerance: TOLERANCE,
    });
  }
};
