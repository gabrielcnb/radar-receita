const express = require("express");
const http = require("http");
const path = require("path");

const app = express();
const PORT = 3000;
const CAMERA_HOST = "191.246.88.18";
const CAMERA_PORT = 5000;
const SCRAPE_INTERVAL = 30_000;
const SPEED_LIMIT = 50;
const TOLERANCE = 7; // inmetro: -7 km/h for speeds < 100

const FINES = {
  speed_20: 130.16,
  speed_50: 195.23,
  speed_50_plus: 880.41,
  red_light: 293.47,
};

let state = {
  lastScrape: null,
  lastError: null,
  today: null,
  vehicles: [],
  semaphoreEvents: [],
  stats: {
    totalVehicles: 0,
    profiles: {},
    lanes: {},
    speedViolations: { up20: 0, up50: 0, over50: 0 },
    redLightCycles: 0,
    estimatedRevenue: 0,
    avgSpeed: 0,
    maxSpeed: 0,
    vehiclesPerHour: {},
  },
  recentFeed: [],
  scrapeCount: 0,
  scrapeErrors: 0,
  lastVehicleCount: 0,
  startedAt: new Date().toISOString(),
};

function getToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fetchLog(datePath, logFile) {
  return new Promise((resolve, reject) => {
    const url = `/download_ritux_log/${datePath}/${logFile}`;
    const req = http.get(
      { host: CAMERA_HOST, port: CAMERA_PORT, path: url, timeout: 20_000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

function fetchAvailableLogs(datePath) {
  return new Promise((resolve, reject) => {
    const url = `/ritux_logs/${datePath}`;
    const req = http.get(
      { host: CAMERA_HOST, port: CAMERA_PORT, path: url, timeout: 10_000 },
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
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

function parseLine(line) {
  const velMatch = line.match(
    /(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\.\d+)[^:]*: (\d+) - F:(\d+) Vel:(\d+)km\/h - Tam:([\d.]+) - Perfil: (\w+)/
  );
  if (velMatch) {
    return {
      type: "vehicle",
      timestamp: velMatch[1],
      sensor: velMatch[2],
      lane: parseInt(velMatch[3]),
      speed: parseInt(velMatch[4]),
      size: parseFloat(velMatch[5]),
      profile: velMatch[6],
    };
  }

  const semMatch = line.match(
    /(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\.\d+)[^:]*: Semaforo\d+ (\w+)/
  );
  if (semMatch) {
    return {
      type: "semaphore",
      timestamp: semMatch[1],
      state: semMatch[2],
    };
  }

  if (line.includes("Multando!")) {
    const ts = line.match(/(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\.\d+)/);
    return { type: "fine_active", timestamp: ts ? ts[1] : "" };
  }

  return null;
}

function processLog(raw) {
  const lines = raw.split("\n");
  const vehicles = [];
  const semaphoreEvents = [];
  let redLightCycles = 0;
  let speedTotal = 0;
  let maxSpeed = 0;
  const profiles = {};
  const lanes = {};
  const speedViolations = { up20: 0, up50: 0, over50: 0 };
  const vehiclesPerHour = {};
  const recentFeed = [];

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;

    if (parsed.type === "vehicle") {
      vehicles.push(parsed);
      speedTotal += parsed.speed;
      if (parsed.speed > maxSpeed) maxSpeed = parsed.speed;
      profiles[parsed.profile] = (profiles[parsed.profile] || 0) + 1;
      lanes[parsed.lane] = (lanes[parsed.lane] || 0) + 1;

      const considered = parsed.speed - TOLERANCE;
      if (considered > SPEED_LIMIT) {
        const pct = ((considered - SPEED_LIMIT) / SPEED_LIMIT) * 100;
        if (pct > 50) speedViolations.over50++;
        else if (pct > 20) speedViolations.up50++;
        else speedViolations.up20++;
      }

      const hourMatch = parsed.timestamp.match(/(\d{2}):\d{2}:\d{2}/);
      if (hourMatch) {
        const h = hourMatch[1];
        vehiclesPerHour[h] = (vehiclesPerHour[h] || 0) + 1;
      }
    } else if (parsed.type === "semaphore") {
      semaphoreEvents.push(parsed);
    } else if (parsed.type === "fine_active") {
      redLightCycles++;
    }
  }

  const totalSpeedFines =
    speedViolations.up20 * FINES.speed_20 +
    speedViolations.up50 * FINES.speed_50 +
    speedViolations.over50 * FINES.speed_50_plus;
  const totalRedFines = redLightCycles * FINES.red_light * 0.15;
  const estimatedRevenue = totalSpeedFines + totalRedFines;

  const last30 = vehicles.slice(-30).reverse();
  for (const v of last30) {
    const considered = v.speed - TOLERANCE;
    let violation = null;
    if (considered > SPEED_LIMIT) {
      const pct = ((considered - SPEED_LIMIT) / SPEED_LIMIT) * 100;
      if (pct > 50) violation = ">50%";
      else if (pct > 20) violation = "20-50%";
      else violation = "<20%";
    }
    recentFeed.push({
      time: v.timestamp.split(" ")[1]?.split(".")[0] || "",
      lane: v.lane,
      speed: v.speed,
      profile: v.profile,
      size: v.size,
      violation,
    });
  }

  return {
    stats: {
      totalVehicles: vehicles.length,
      profiles,
      lanes,
      speedViolations,
      redLightCycles,
      estimatedRevenue: Math.round(estimatedRevenue * 100) / 100,
      avgSpeed:
        vehicles.length > 0
          ? Math.round((speedTotal / vehicles.length) * 10) / 10
          : 0,
      maxSpeed,
      vehiclesPerHour,
    },
    recentFeed,
  };
}

async function scrape() {
  try {
    const today = getToday();
    const logs = await fetchAvailableLogs(today);
    const mainLog = logs[0] || "rl001008.log";
    const raw = await fetchLog(today, mainLog);
    const result = processLog(raw);

    state.today = today;
    state.stats = result.stats;
    state.recentFeed = result.recentFeed;
    state.lastScrape = new Date().toISOString();
    state.lastError = null;
    state.scrapeCount++;
    state.lastVehicleCount = result.stats.totalVehicles;
  } catch (e) {
    state.lastError = e.message;
    state.scrapeErrors++;
    console.error("scrape error:", e.message);
  }
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/stats", (_req, res) => {
  res.json({
    today: state.today,
    lastScrape: state.lastScrape,
    lastError: state.lastError,
    stats: state.stats,
    recentFeed: state.recentFeed,
    fines: FINES,
    speedLimit: SPEED_LIMIT,
    tolerance: TOLERANCE,
  });
});

app.get("/api/health", (_req, res) => {
  const now = Date.now();
  const lastScrapeAge = state.lastScrape
    ? Math.round((now - new Date(state.lastScrape).getTime()) / 1000)
    : null;
  const healthy = state.lastScrape && !state.lastError && lastScrapeAge < 90;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    uptime: Math.round((now - new Date(state.startedAt).getTime()) / 1000),
    scrapes: state.scrapeCount,
    errors: state.scrapeErrors,
    lastScrapeAgeSec: lastScrapeAge,
    lastError: state.lastError,
    vehiclesTracked: state.lastVehicleCount,
  });
});

app.listen(PORT, async () => {
  console.log(`http://localhost:${PORT}`);
  await scrape();
  setInterval(scrape, SCRAPE_INTERVAL);
});
