process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const tough = require("tough-cookie");
const { MongoClient } = require("mongodb");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.DB_NAME || "zeno_dashboard";
const publicPath = path.join(__dirname, "../public");

// Email / SMTP configuration (set via environment variables)
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_SECURE = (process.env.SMTP_SECURE || "false").toLowerCase() === "true";

let mailTransporter = null;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || "no-reply@example.com";

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    mailTransporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        }
    });

    mailTransporter.verify().then(() => {
        console.log(`SMTP configured: host=${SMTP_HOST}, user=${SMTP_USER}, secure=${SMTP_SECURE}`);
    }).catch((err) => {
        console.error("SMTP verification failed:", err && err.message ? err.message : err);
        mailTransporter = null;
    });
} else {
    console.warn("SMTP not configured; skipping sending verification email.");
}

let usersCollection;
let sensorDataCollection;
let antennaDataCollection;
let qosDataCollection;

const jar = new tough.CookieJar();
const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    timeout: 10000
}));

const BASE_URL = process.env.CPE_BASE_URL || "https://192.168.1.3";
const DEVICE_USER = process.env.CPE_USER || "admin";
const DEVICE_PASS = process.env.CPE_PASS || "1234";
const CPE_COOKIE = process.env.CPE_COOKIE || "";
const ESP32_BASE_URL = process.env.ESP32_BASE_URL || "http://192.168.1.10";
const QOS_TARGET_HOST = process.env.QOS_TARGET_HOST || process.env.CPE_BASE_URL || "192.168.1.2";
let cpeCookieOverride = CPE_COOKIE;
let cpePasswordEncoder;
let cpeLockUntil = 0;

const sessions = new Map();
const fallbackUsers = [
    { username: "admin", passwordHash: hashPassword("admin123"), role: "admin" },
    { username: "user", passwordHash: hashPassword("password123"), role: "user" }
];

let motorState = {
    position: 0,
    isMoving: false,
    direction: null
};

const MOTOR_STEP_INCREMENT = 50;
const MOTOR_MIN_POSITION = 0;
const MOTOR_MAX_POSITION = 500;
const MOTOR_MOVE_DELAY = Number(process.env.MOTOR_MOVE_DURATION_MS || 40000);

let waterLevelState = {
    level: 0,
    distance: null,
    status: "Menunggu data ESP32",
    lastUpdated: null
};

const HISTORY_LIMIT = 50;
const historyState = {
    servo: [],
    antenna: [],
    water: [],
    qos: []
};
const MAX_CHART_POINTS = 20;
const pingHistory = [];
const WATER_HISTORY_THRESHOLD_CM = 2;
let lastAntennaSnapshot = null;
let lastWaterSnapshot = null;
let latestCpeData = null;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function hashPassword(password) {
    return crypto.createHash("sha256").update(password).digest("hex");
}

function generateVerificationCode() {
    // 6-digit numeric code
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashCode(code) {
    return crypto.createHash("sha256").update(String(code)).digest("hex");
}

async function sendVerificationEmail(email, code, username) {
    if (!mailTransporter) {
        console.warn("SMTP not configured; skipping sending verification email to", email);
        // For local development, print the OTP to console so developer can test verification.
        try {
            console.info(`DEV OTP for ${email}: ${code}`);
        } catch (e) {
            // ignore logging errors
        }
        return true;
    }

    const mailOptions = {
        from: process.env.SMTP_FROM || SMTP_USER,
        to: email,
        subject: "[Dashboard] Kode Verifikasi Email",
        text: `Halo ${username || "pengguna"},\n\nGunakan kode berikut untuk memverifikasi email Anda: ${code}\nKode berlaku 15 menit.\n\nJika Anda tidak meminta kode ini, abaikan email ini.`,
        html: `<p>Halo ${username || "pengguna"},</p><p>Gunakan kode berikut untuk memverifikasi email Anda:</p><h2>${code}</h2><p>Kode berlaku 15 menit.</p>`
    };

    try {
        await mailTransporter.sendMail(mailOptions);
        return true;
    } catch (err) {
        console.error("Gagal mengirim email verifikasi:", err.message);
        return false;
    }
}

function getCookie(req, name) {
    const rawCookie = req.headers.cookie || "";
    const cookies = rawCookie.split(";").map((cookie) => cookie.trim());
    const found = cookies.find((cookie) => cookie.startsWith(`${name}=`));
    return found ? decodeURIComponent(found.split("=")[1]) : null;
}

function setSessionCookie(res, sessionId) {
    res.setHeader("Set-Cookie", `sessionId=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
}

function clearSessionCookie(res) {
    res.setHeader("Set-Cookie", "sessionId=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function getSession(req) {
    const sessionId = getCookie(req, "sessionId");
    if (!sessionId) {
        return null;
    }

    const session = sessions.get(sessionId);
    if (!session) {
        return null;
    }

    const oneDay = 24 * 60 * 60 * 1000;
    if (Date.now() - session.createdAt > oneDay) {
        sessions.delete(sessionId);
        return null;
    }

    return { id: sessionId, ...session };
}

function requireAuth(req, res, next) {
    const session = getSession(req);
    if (!session) {
        if (req.path.startsWith("/api/")) {
            return res.status(401).json({ success: false, message: "Silakan login terlebih dahulu" });
        }

        return res.redirect("/login.html");
    }

    req.session = session;
    next();
}

function addHistoryEvent(type, event) {
    if (!historyState[type]) {
        return;
    }

    historyState[type].unshift({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: Date.now(),
        ...event
    });

    historyState[type] = historyState[type].slice(0, HISTORY_LIMIT);
}

function recordWaterHistory(distance, status) {
    const snapshot = {
        level: Number(distance),
        distance: Number(distance),
        status,
        timestamp: Date.now()
    };

    if (!Number.isFinite(snapshot.level)) {
        return;
    }

    if (!lastWaterSnapshot) {
        lastWaterSnapshot = snapshot;
        addHistoryEvent("water", {
            event: "Data air diterima",
            ...snapshot
        });
        return;
    }

    const levelDiff = Math.abs(snapshot.level - lastWaterSnapshot.level);
    const statusChanged = snapshot.status !== lastWaterSnapshot.status;

    if (levelDiff < WATER_HISTORY_THRESHOLD_CM && !statusChanged) {
        return;
    }

    addHistoryEvent("water", {
        event: statusChanged ? "Status air berubah" : "Level air berubah",
        previous: lastWaterSnapshot,
        ...snapshot
    });
    lastWaterSnapshot = snapshot;
}

function getAntennaSnapshot(data) {
    return {
        rssi: data.rssiValue || "-",
        rssiCombined: data.rssiValueCombined || "-",
        snr: data.snrValue || "-",
        channel: data.channel || "-"
    };
}

function parsePingOutput(output) {
    const normalized = String(output || "");

    const sentMatch = normalized.match(/Sent\s*=\s*(\d+)/i) || normalized.match(/(\d+)\s+packets transmitted/i);
    const receivedMatch = normalized.match(/Received\s*=\s*(\d+)/i) || normalized.match(/(\d+)\s+packets received/i);
    const lossMatch = normalized.match(/Lost\s*=\s*(\d+)\s*\(([^)]+)%\s*loss\)/i) || normalized.match(/loss\s*=\s*(\d+(?:\.\d+)?)%/i) || normalized.match(/(\d+(?:\.\d+)?)%\s*packet loss/i);
    const avgMatch = normalized.match(/Average\s*=\s*(\d+(?:\.\d+)?)\s*ms/i) || normalized.match(/min\/avg\/max\/mdev.*?\/\s*([\d.]+)\//i);
    const minMatch = normalized.match(/Minimum\s*=\s*(\d+(?:\.\d+)?)\s*ms/i) || normalized.match(/min\/avg\/max\/mdev\s*=\s*([\d.]+)\//i);
    const maxMatch = normalized.match(/Maximum\s*=\s*(\d+(?:\.\d+)?)\s*ms/i) || normalized.match(/min\/avg\/max\/mdev\s*=\s*[\d.]+\/[\d.]+\/([\d.]+)\//i);
    const latencySamples = Array.from(normalized.matchAll(/(?:time|waktu)[=<]\s*(\d+(?:\.\d+)?)\s*ms/gi))
        .map((match) => Number(match[1]))
        .filter((value) => Number.isFinite(value));
    const jitterMs = latencySamples.length > 1
        ? latencySamples.slice(1).reduce((total, value, index) => total + Math.abs(value - latencySamples[index]), 0) / (latencySamples.length - 1)
        : null;

    const packetLoss = lossMatch
        ? Number((lossMatch[2] ?? lossMatch[1]).replace(/[^\d.]/g, ""))
        : null;

    return {
        packetsSent: sentMatch ? Number(sentMatch[1] || sentMatch[2]) : null,
        packetsReceived: receivedMatch ? Number(receivedMatch[1] || receivedMatch[2]) : null,
        packetLoss: Number.isFinite(packetLoss) ? packetLoss : null,
        minLatencyMs: minMatch ? Number(minMatch[1] || minMatch[2]) : null,
        avgLatencyMs: avgMatch ? Number(avgMatch[1] || avgMatch[2]) : null,
        maxLatencyMs: maxMatch ? Number(maxMatch[1] || maxMatch[2]) : null,
        jitterMs,
        latencySamples,
        raw: normalized.trim()
    };
}

function addPingHistory(result) {
    pingHistory.unshift(result);
    if (pingHistory.length > MAX_CHART_POINTS) {
        pingHistory.length = MAX_CHART_POINTS;
    }
}

function getLatestPingPacketLoss() {
    const latest = pingHistory.find((item) => item && item.packetLoss !== null && item.packetLoss !== undefined);
    return latest ? latest.packetLoss : null;
}

function parseRateMbps(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    const text = String(value).trim();
    const numericMatch = text.match(/[-+]?\d+(?:\.\d+)?/);
    if (!numericMatch) {
        return null;
    }

    const numeric = Number(numericMatch[0]);
    if (!Number.isFinite(numeric)) {
        return null;
    }

    if (/gbps/i.test(text)) {
        return numeric * 1000;
    }

    if (/\bkbps\b/i.test(text)) {
        return numeric / 1000;
    }

    if (/\bbps\b/i.test(text) && !/mbps/i.test(text)) {
        return numeric / 1000000;
    }

    return numeric;
}

function formatMetric(value, unit, digits = 1) {
    return Number.isFinite(value) ? `${value.toFixed(digits)} ${unit}` : "-";
}

function buildQosSnapshot(cpeData, pingResult, source = "ping") {
    const txThroughputMbps = parseRateMbps(cpeData && cpeData.clientTxRate);
    const rxThroughputMbps = parseRateMbps(cpeData && cpeData.clientRxRate);
    const throughputMbps = Number.isFinite(rxThroughputMbps)
        ? rxThroughputMbps
        : Number.isFinite(txThroughputMbps)
            ? txThroughputMbps
            : null;

    return {
        timestamp: Date.now(),
        source,
        host: pingResult ? pingResult.host : String(BASE_URL).replace(/^https?:\/\//, "").replace(/\/$/, ""),
        packetLoss: pingResult && pingResult.packetLoss !== undefined ? pingResult.packetLoss : null,
        delayMs: pingResult && pingResult.avgLatencyMs !== undefined ? pingResult.avgLatencyMs : null,
        jitterMs: pingResult && pingResult.jitterMs !== undefined ? pingResult.jitterMs : null,
        throughputMbps,
        txThroughputMbps,
        rxThroughputMbps,
        packetsSent: pingResult ? pingResult.packetsSent : null,
        packetsReceived: pingResult ? pingResult.packetsReceived : null,
        minLatencyMs: pingResult ? pingResult.minLatencyMs : null,
        maxLatencyMs: pingResult ? pingResult.maxLatencyMs : null
    };
}

function recordQosHistory(qos) {
    addHistoryEvent("qos", {
        event: "QoS measured",
        ...qos
    });
}

async function saveQosDataToMongo(qos) {
    if (!qosDataCollection) {
        console.warn("MongoDB qosDataCollection belum siap, data QoS tidak disimpan ke database.");
        return;
    }

    try {
        await qosDataCollection.insertOne({
            ...qos,
            timestamp: new Date(qos.timestamp),
            createdAt: new Date()
        });
    } catch (err) {
        console.error("Gagal menyimpan data QoS ke MongoDB:", err.message);
    }
}

async function saveAntennaDataToMongo(data) {
    if (!antennaDataCollection) {
        console.warn("MongoDB antennaDataCollection belum siap, data antenna tidak disimpan ke database.");
        return;
    }

    try {
        await antennaDataCollection.insertOne({
            source: "cpe210",
            timestamp: new Date(),
            createdAt: new Date(),
            rssiValue: data.rssiValue ?? null,
            rssiValueCombined: data.rssiValueCombined ?? null,
            snrValue: data.snrValue ?? null,
            noiseStrength: data.noiseStrength ?? null,
            noiseValue: data.noiseValue ?? null,
            channel: data.channel ?? null,
            lanIpAddress: data.lanIpAddress ?? null,
            lanMacAddr: data.lanMacAddr ?? null,
            clientTxRate: data.clientTxRate ?? null,
            clientRxRate: data.clientRxRate ?? null,
            clientSsid: data.clientSsid ?? null,
            deviceName: data.deviceName ?? null,
            raw: data
        });
    } catch (err) {
        console.error("Gagal menyimpan data antenna ke MongoDB:", err.message);
    }
}

function recordAntennaHistory(data) {
    const snapshot = getAntennaSnapshot(data);
    const hasReadableValue = Object.values(snapshot).some((value) => value !== "-");

    if (!hasReadableValue) {
        return;
    }

    if (!lastAntennaSnapshot) {
        lastAntennaSnapshot = snapshot;
        addHistoryEvent("antenna", {
            event: "Data antenna terbaca",
            ...snapshot
        });
        return;
    }

    const hasChanged = Object.keys(snapshot).some((key) => snapshot[key] !== lastAntennaSnapshot[key]);
    if (!hasChanged) {
        return;
    }

    addHistoryEvent("antenna", {
        event: "Level antenna berubah",
        previous: lastAntennaSnapshot,
        ...snapshot
    });
    lastAntennaSnapshot = snapshot;
}

async function connectMongo() {
    const mongoClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoClient.connect();

    const db = mongoClient.db(DB_NAME);
    usersCollection = db.collection("users");
    sensorDataCollection = db.collection("sensor_data");
    antennaDataCollection = db.collection("antenna_data");
    qosDataCollection = db.collection("qos_data");

    await usersCollection.createIndex({ username: 1 }, { unique: true });
    await sensorDataCollection.createIndex({ timestamp: -1 });
    await antennaDataCollection.createIndex({ timestamp: -1 });
    await qosDataCollection.createIndex({ timestamp: -1 });
    await ensureDefaultUsers();

    console.log(`MongoDB terhubung: ${MONGO_URI} / ${DB_NAME}`);
}

async function ensureDefaultUsers() {
    const defaultUsers = [
        { username: "admin", password: "admin123", role: "admin" },
        { username: "user", password: "password123", role: "user" }
    ];

    for (const user of defaultUsers) {
        await usersCollection.updateOne(
            { username: user.username },
            {
                $setOnInsert: {
                    username: user.username,
                    passwordHash: hashPassword(user.password),
                    role: user.role,
                    createdAt: new Date()
                }
            },
            { upsert: true }
        );
    }
}

async function findUser(username) {
    if (!username) {
        return null;
    }

    if (usersCollection) {
        const user = await usersCollection.findOne({ username });
        if (user) {
            return user;
        }
    }

    return fallbackUsers.find((user) => user.username === username) || null;
}

async function verifyPassword(user, password) {
    if (!user) {
        return false;
    }

    const passwordHash = hashPassword(password);
    if (user.passwordHash === passwordHash) {
        return true;
    }

    // Backward compatibility for users created by the older plain-text version.
    if (user.password && user.password === password) {
        if (usersCollection && user._id) {
            await usersCollection.updateOne(
                { _id: user._id },
                { $set: { passwordHash }, $unset: { password: "" } }
            );
        }

        return true;
    }

    return false;
}

app.get("/", (req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
});

app.get("/index.html", (req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
});

app.get("/login", (req, res) => {
    res.redirect("/login.html");
});

app.get("/login.html", (req, res) => {
    if (getSession(req)) {
        return res.redirect("/dashboard");
    }

    return res.sendFile(path.join(publicPath, "login.html"));
});

app.get(["/dashboard", "/dashboard.html"], requireAuth, (req, res) => {
    res.sendFile(path.join(publicPath, "dashboard.html"));
});

app.use(express.static(publicPath, { index: false }));

app.post("/api/signup", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");
        const email = String(req.body.email || "").trim().toLowerCase();

        if (username.length < 3) {
            return res.status(400).json({ success: false, message: "Username minimal 3 karakter" });
        }

        if (password.length < 6) {
            return res.status(400).json({ success: false, message: "Password minimal 6 karakter" });
        }

        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return res.status(400).json({ success: false, message: "Email tidak valid" });
        }

        if (!usersCollection) {
            return res.status(503).json({
                success: false,
                message: "Signup membutuhkan MongoDB aktif. Jalankan MongoDB lalu coba lagi."
            });
        }

        // check for existing username or email
        const existing = await usersCollection.findOne({ $or: [{ username }, { email }] });
        if (existing) {
            return res.status(409).json({ success: false, message: "Username atau email sudah digunakan" });
        }

        const verificationCode = generateVerificationCode();
        const verificationCodeHash = hashCode(verificationCode);
        const codeExpires = Date.now() + 15 * 60 * 1000; // 15 minutes

        const userDoc = {
            username,
            email,
            passwordHash: hashPassword(password),
            role: "user",
            emailVerified: false,
            verificationCodeHash,
            verificationCodeExpires: new Date(codeExpires),
            createdAt: new Date()
        };

        await usersCollection.insertOne(userDoc);

        // try to send verification email (non-blocking)
        sendVerificationEmail(email, verificationCode, username).then((ok) => {
            if (!ok) {
                console.warn("Pengguna dibuat tetapi email verifikasi gagal dikirim ke", email);
            }
        }).catch(() => {});

        return res.status(201).json({
            success: true,
            message: "Akun berhasil dibuat. Kode verifikasi telah dikirim ke email Anda.",
            username
        });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ success: false, message: "Username atau email sudah digunakan" });
        }

        console.error("Signup error:", err.message);
        return res.status(500).json({ success: false, message: "Signup gagal", details: err.message });
    }
});

// Verify email with OTP
app.post("/api/verify-email", async (req, res) => {
    try {
        const identifier = String(req.body.username || req.body.email || "").trim();
        const code = String(req.body.code || "").trim();

        if (!identifier || !code) {
            return res.status(400).json({ success: false, message: "Username/email dan kode verifikasi diperlukan" });
        }

        const query = identifier.includes("@") ? { email: identifier.toLowerCase() } : { username: identifier };
        const user = await usersCollection.findOne(query);
        if (!user) {
            return res.status(404).json({ success: false, message: "User tidak ditemukan" });
        }

        if (user.emailVerified) {
            return res.json({ success: true, message: "Email sudah terverifikasi" });
        }

        if (!user.verificationCodeHash || !user.verificationCodeExpires) {
            return res.status(400).json({ success: false, message: "Tidak ada kode verifikasi aktif. Minta kirim ulang kode." });
        }

        if (new Date() > new Date(user.verificationCodeExpires)) {
            return res.status(400).json({ success: false, message: "Kode verifikasi sudah kadaluarsa" });
        }

        if (hashCode(code) !== user.verificationCodeHash) {
            return res.status(400).json({ success: false, message: "Kode verifikasi salah" });
        }

        await usersCollection.updateOne({ _id: user._id }, { $set: { emailVerified: true }, $unset: { verificationCodeHash: "", verificationCodeExpires: "" } });

        const sessionId = generateSessionId();
        sessions.set(sessionId, {
            username: user.username,
            userId: user._id.toString(),
            createdAt: Date.now()
        });
        setSessionCookie(res, sessionId);

        return res.json({ success: true, message: "Email berhasil diverifikasi", redirect: true });
    } catch (err) {
        console.error("Verify email error:", err.message);
        return res.status(500).json({ success: false, message: "Gagal memverifikasi email", details: err.message });
    }
});

// Resend verification code
app.post("/api/resend-verification", async (req, res) => {
    try {
        const identifier = String(req.body.username || req.body.email || "").trim();
        if (!identifier) {
            return res.status(400).json({ success: false, message: "Username atau email diperlukan" });
        }

        const query = identifier.includes("@") ? { email: identifier.toLowerCase() } : { username: identifier };
        const user = await usersCollection.findOne(query);
        if (!user) {
            return res.status(404).json({ success: false, message: "User tidak ditemukan" });
        }

        if (user.emailVerified) {
            return res.json({ success: true, message: "Email sudah terverifikasi" });
        }

        const verificationCode = generateVerificationCode();
        const verificationCodeHash = hashCode(verificationCode);
        const codeExpires = Date.now() + 15 * 60 * 1000;

        await usersCollection.updateOne({ _id: user._id }, { $set: { verificationCodeHash, verificationCodeExpires: new Date(codeExpires) } });

        sendVerificationEmail(user.email, verificationCode, user.username).then((ok) => {
            if (!ok) console.warn("Gagal mengirim ulang email verifikasi ke", user.email);
        }).catch(() => {});

        return res.json({ success: true, message: "Kode verifikasi baru telah dikirim" });
    } catch (err) {
        console.error("Resend verification error:", err.message);
        return res.status(500).json({ success: false, message: "Gagal kirim ulang kode verifikasi", details: err.message });
    }
});

// Request login OTP (passwordless) - sends OTP to user's email
app.post("/api/request-login-otp", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return res.status(400).json({ success: false, message: "Email tidak valid" });
        }

        if (!usersCollection) {
            return res.status(503).json({ success: false, message: "Service tidak tersedia. Coba lagi nanti." });
        }

        const user = await usersCollection.findOne({ email });
        if (!user) {
            return res.status(404).json({ success: false, message: "Email tidak terdaftar" });
        }

        const verificationCode = generateVerificationCode();
        const verificationCodeHash = hashCode(verificationCode);
        const codeExpires = Date.now() + 15 * 60 * 1000;

        await usersCollection.updateOne({ _id: user._id }, { $set: { verificationCodeHash, verificationCodeExpires: new Date(codeExpires) } });

        sendVerificationEmail(user.email, verificationCode, user.username).then((ok) => {
            if (!ok) console.warn("Gagal mengirim OTP login ke", user.email);
        }).catch(() => {});

        return res.json({ success: true, message: "Kode OTP telah dikirim ke email Anda" });
    } catch (err) {
        console.error("Request login OTP error:", err.message);
        return res.status(500).json({ success: false, message: "Gagal proses OTP", details: err.message });
    }
});

// Verify login OTP and create session (passwordless login)
app.post("/api/verify-login-otp", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const code = String(req.body.code || "").trim();

        if (!email || !code) {
            return res.status(400).json({ success: false, message: "Email dan kode OTP diperlukan" });
        }

        if (!usersCollection) {
            return res.status(503).json({ success: false, message: "Service tidak tersedia" });
        }

        const user = await usersCollection.findOne({ email });
        if (!user) {
            return res.status(404).json({ success: false, message: "User tidak ditemukan" });
        }

        if (!user.verificationCodeHash || !user.verificationCodeExpires) {
            return res.status(400).json({ success: false, message: "Tidak ada kode OTP aktif. Minta kirim ulang kode." });
        }

        if (new Date() > new Date(user.verificationCodeExpires)) {
            return res.status(400).json({ success: false, message: "Kode OTP sudah kadaluarsa" });
        }

        if (hashCode(code) !== user.verificationCodeHash) {
            return res.status(400).json({ success: false, message: "Kode OTP salah" });
        }

        // mark email verified and clear OTP
        await usersCollection.updateOne({ _id: user._id }, { $set: { emailVerified: true }, $unset: { verificationCodeHash: "", verificationCodeExpires: "" } });

        // create session and set cookie
        const sessionId = generateSessionId();
        sessions.set(sessionId, {
            username: user.username,
            userId: user._id.toString(),
            createdAt: Date.now()
        });
        setSessionCookie(res, sessionId);

        return res.json({ success: true, message: "Login berhasil", username: user.username });
    } catch (err) {
        console.error("Verify login OTP error:", err.message);
        return res.status(500).json({ success: false, message: "Gagal verifikasi OTP", details: err.message });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");
        const validUser = await findUser(username);
        const passwordMatches = await verifyPassword(validUser, password);

        if (!passwordMatches) {
            return res.status(401).json({ success: false, message: "Username atau password salah" });
        }

        // If user is stored in MongoDB, require email verification
        if (usersCollection && validUser && validUser._id && !validUser.emailVerified) {
            return res.status(403).json({ success: false, message: "Email belum terverifikasi. Silakan verifikasi melalui email Anda." });
        }

        const sessionId = generateSessionId();
        sessions.set(sessionId, {
            username,
            userId: validUser._id ? validUser._id.toString() : username,
            createdAt: Date.now()
        });
        setSessionCookie(res, sessionId);

        return res.json({ success: true, message: "Login berhasil", username });
    } catch (err) {
        console.error("Login error:", err.message);
        return res.status(500).json({ success: false, message: "Login gagal", details: err.message });
    }
});

app.get("/api/me", (req, res) => {
    const session = getSession(req);
    if (!session) {
        return res.status(401).json({ success: false, message: "Belum login" });
    }

    return res.json({ success: true, username: session.username });
});

app.post("/api/logout", (req, res) => {
    const session = getSession(req);
    if (session) {
        sessions.delete(session.id);
    }

    clearSessionCookie(res);
    res.json({ success: true, message: "Logout berhasil" });
});

function getWaterStatus(distance) {
    if (distance === null || Number.isNaN(distance)) {
        return "Menunggu data ESP32";
    }

    // Range water monitoring:
    // 52-75 cm = Aman
    // 42-51 cm = Siaga
    // 20-41 cm = Bahaya
    if (distance >= 52 && distance <= 75) {
        return "Aman";
    }

    if (distance >= 42 && distance <= 51) {
        return "Siaga";
    }

    if (distance >= 20 && distance <= 41) {
        return "Bahaya";
    }

    if (distance > 75) {
        return "Aman";
    }

    return "Bahaya";
}

app.post("/data", async (req, res) => {
    const distance = Number(req.body.jarak);

    console.log(`Request /data dari ${req.ip}:`, req.body);

    if (!Number.isFinite(distance)) {
        return res.status(400).json({
            success: false,
            message: "Field 'jarak' harus berupa angka"
        });
    }

    const timestamp = new Date();
    const status = getWaterStatus(distance);
    waterLevelState = {
        level: distance,
        distance,
        status,
        lastUpdated: timestamp.getTime()
    };

    recordWaterHistory(distance, status);

    try {
        if (sensorDataCollection) {
            await sensorDataCollection.insertOne({
                source: "esp32",
                jarak: distance,
                status: waterLevelState.status,
                timestamp,
                createdAt: new Date()
            });
        } else {
            console.warn("MongoDB sensorDataCollection belum siap, data sensor hanya disimpan di memori.");
        }
    } catch (err) {
        console.error("Gagal menyimpan data sensor ke MongoDB:", err.message);
    }

    console.log(`Data ESP32 diterima: jarak=${distance} cm, status=${waterLevelState.status}`);
    return res.json({ success: true, water: waterLevelState });
});

app.get("/data", (req, res) => {
    res.json({
        success: true,
        message: "Endpoint /data aktif. ESP32 harus mengirim POST JSON ke endpoint ini.",
        expectedBody: { jarak: 66 },
        water: waterLevelState
    });
});

app.get("/api/water", requireAuth, (req, res) => {
    res.json({ success: true, water: waterLevelState });
});

async function runPingTest(host, count = 4) {
    const safeHost = String(host || BASE_URL).replace(/^https?:\/\//, "").replace(/\/$/, "");
    const command = process.platform === "win32"
        ? `ping -n ${count} ${safeHost}`
        : `ping -c ${count} ${safeHost}`;

    return new Promise((resolve, reject) => {
        exec(command, { timeout: 45000 }, (error, stdout, stderr) => {
            const output = [stdout, stderr].filter(Boolean).join("\n");
            const parsed = parsePingOutput(output);

            if (error && parsed.avgLatencyMs === null && parsed.packetsReceived === null) {
                reject(new Error(`Ping gagal: ${error.message}`));
                return;
            }

            resolve({
                host: safeHost,
                count,
                success: true,
                timestamp: Date.now(),
                ...parsed,
                message: parsed.avgLatencyMs !== null
                    ? `Ping ke ${safeHost} berhasil (${parsed.avgLatencyMs.toFixed(1)} ms)`
                    : "Ping selesai"
            });
        });
    });
}

// New endpoint: Get latest packet loss from ping history
app.get("/api/packet-loss", requireAuth, (req, res) => {
    try {
        if (pingHistory && pingHistory.length > 0) {
            const latest = pingHistory[0];
            return res.json({
                success: true,
                packetLoss: latest.packetLoss,
                timestamp: latest.timestamp,
                host: latest.host
            });
        }

        return res.json({
            success: true,
            packetLoss: null,
            message: "No ping data yet"
        });
    } catch (err) {
        console.error("Get packet loss error:", err.message);
        return res.status(500).json({ success: false, message: "Gagal ambil packet loss", details: err.message });
    }
});

app.get("/api/ping", requireAuth, async (req, res) => {
    try {
        const host = String(req.query.host || BASE_URL).trim();
        const count = Number(req.query.count || 4);

        if (!host) {
            return res.status(400).json({ success: false, message: "Host ping wajib diisi" });
        }

        const pingResult = await runPingTest(host, Number.isFinite(count) && count > 0 ? count : 4);
        addPingHistory(pingResult);

        return res.json({ success: true, ping: pingResult, history: pingHistory.slice(0, 10) });
    } catch (err) {
        console.error("Ping test error:", err.message);
        return res.status(500).json({ success: false, message: "Gagal menjalankan ping", details: err.message });
    }
});

// New endpoint: Get ping history
app.get("/api/ping-history", requireAuth, (req, res) => {
    try {
        return res.json({ success: true, history: pingHistory });
    } catch (err) {
        console.error("Get ping history error:", err.message);
        return res.status(500).json({ success: false, message: "Gagal mendapatkan ping history", details: err.message });
    }
});

app.get("/api/qos", requireAuth, async (req, res) => {
    try {
        const host = String(req.query.host || QOS_TARGET_HOST).trim();
        const count = Number(req.query.count || 4);
        const pingResult = await runPingTest(host, Number.isFinite(count) && count > 0 ? count : 4);
        addPingHistory(pingResult);

        let cpeData = latestCpeData;
        if (!cpeData) {
            try {
                cpeData = await getDataFromCPEWithLogin();
                latestCpeData = cpeData;
            } catch (cpeErr) {
                console.warn("QoS throughput fallback: gagal ambil data CPE:", cpeErr.message);
            }
        }

        const qos = buildQosSnapshot(cpeData, pingResult);
        recordQosHistory(qos);
        await saveQosDataToMongo(qos);

        return res.json({
            success: true,
            qos,
            history: historyState.qos.slice(0, 20)
        });
    } catch (err) {
        console.error("QoS error:", err.message);
        return res.status(500).json({ success: false, message: "Gagal mengambil data QoS", details: err.message });
    }
});

async function loginToCPE() {
    console.log("Logging in to CPE210...");
    cpeCookieOverride = "";
    await jar.removeAllCookies();

    await client.get(`${BASE_URL}/data/version.json`, getCpeRequestConfig());

    const nonce = await getCpeCookieValue();
    if (!nonce) {
        throw new Error("CPE tidak mengirim cookie awal untuk nonce login.");
    }

    const encodePassword = await getCpePasswordEncoder();
    const encodedPassword = encodePassword(DEVICE_PASS).toUpperCase();
    const encoded = `${DEVICE_USER}:${encodePassword(`${encodedPassword}:${nonce}`).toUpperCase()}`;
    const payload = new URLSearchParams({ encoded, nonce }).toString();
    const response = await client.post(`${BASE_URL}/data/version.json`, payload, {
        ...getCpeRequestConfig(),
        headers: {
            ...getCpeRequestConfig().headers,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        }
    });

    console.log("CPE login response:", JSON.stringify(response.data));

    if (!response.data) {
        throw new Error("Login CPE gagal. Respons kosong dari perangkat.");
    }

    const lockTime = Number(response.data.lockTime || 0);
    if (response.data.status === 1 || response.data.timeout === true) {
        if (lockTime > 0) {
            cpeLockUntil = Date.now() + lockTime * 1000;
        }

        throw new Error(
            `Login CPE gagal. Perangkat sedang menolak login (${response.data.failedCount ?? 0} percobaan gagal, lockTime ${lockTime} detik). ` +
            "Periksa password CPE_USER/CPE_PASS atau tunggu hingga lockout selesai."
        );
    }

    if (response.data.status !== 0) {
        throw new Error(`Login CPE gagal. Status CPE: ${response.data.status}`);
    }

    cpeLockUntil = 0;
}

async function getCpeCookieValue() {
    const cookies = await jar.getCookies(BASE_URL);
    const cpeCookie = cookies.find((cookie) => cookie.key.toUpperCase() === "COOKIE");
    return cpeCookie ? cpeCookie.value : null;
}

async function getCpePasswordEncoder() {
    if (cpePasswordEncoder) {
        return cpePasswordEncoder;
    }

    const response = await client.get(`${BASE_URL}/js/app/app.js`, getCpeRequestConfig());
    const script = String(response.data);
    const endIndex = script.indexOf("$.su.Device");

    if (endIndex === -1) {
        throw new Error("Tidak menemukan fungsi encoder login di js/app/app.js.");
    }

    const encoderSource = script.slice(0, endIndex);
    const encoderFactory = new Function(`${encoderSource}; return encode;`);
    cpePasswordEncoder = encoderFactory();

    return cpePasswordEncoder;
}

function getCpeRequestConfig() {
    const headers = {
        Accept: "application/json, text/javascript, */*; q=0.01",
        Referer: `${BASE_URL}/`,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 CPE210-Monitoring-Dashboard"
    };

    if (!cpeCookieOverride) {
        return { headers };
    }

    const cookieValue = cpeCookieOverride.includes("=") ? cpeCookieOverride : `COOKIE=${cpeCookieOverride}`;
    headers.Cookie = cookieValue;

    return {
        headers
    };
}

function parseNumericPacketLoss(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    const stringValue = String(value).trim();
    const match = stringValue.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
    if (match) {
        return Number(match[1]);
    }

    const numeric = Number(stringValue.replace(/[^0-9.-]+/g, ""));
    return Number.isFinite(numeric) ? numeric : null;
}

function extractPacketLossFromCpeData(data) {
    if (!data || typeof data !== "object") {
        return null;
    }

    const candidates = [
        data.packetLoss,
        data.packet_loss,
        data.loss,
        data.wirelessPacketLoss,
        data.packetLossPercent,
        data.packet_loss_percent,
        data.txLoss,
        data.rxLoss,
        data.lossPercent,
        data.loss_percentage
    ];

    for (const value of candidates) {
        const parsed = parseNumericPacketLoss(value);
        if (parsed !== null) {
            return parsed;
        }
    }

    return null;
}

function isCpeInfoData(data) {
    return Boolean(data && typeof data === "object" && (
        data.lanIpAddress ||
        data.deviceName ||
        data.rssiValueCombined ||
        data.clientSsid
    ));
}

function normalizeCpeData(rawData) {
    // Pass through as-is if it matches expected structure
    if (isCpeInfoData(rawData)) {
        return rawData;
    }
    // If raw data has nested structure, extract it
    if (rawData && rawData.data && isCpeInfoData(rawData.data)) {
        return rawData.data;
    }
    // Otherwise return as-is and let isCpeInfoData validation handle it
    return rawData || {};
}

async function getDataFromCPE() {
    const cacheBuster = Date.now();
    const infoPaths = [
        `/data/info.json?autorefresh=true&_=${cacheBuster}`,
        "/data/info.json",
        "/data/info.js",
        `/data/info?js&_=${cacheBuster}`
    ];
    let lastError;

    for (const infoPath of infoPaths) {
        try {
            const res = await client.get(`${BASE_URL}${infoPath}`, getCpeRequestConfig());
            console.log(`Raw data from CPE210 (${infoPath}):`, JSON.stringify(res.data, null, 2));
            const cpeData = normalizeCpeData(res.data);

            if (isCpeInfoData(cpeData)) {
                return cpeData;
            }

            lastError = new Error(`Endpoint ${infoPath} tidak mengembalikan data info CPE. Kemungkinan session login CPE timeout atau login API belum sesuai.`);
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError;
}

async function getDataFromCPEWithLogin() {
    if (cpeLockUntil > Date.now()) {
        const waitSeconds = Math.max(1, Math.ceil((cpeLockUntil - Date.now()) / 1000));
        throw new Error(`Login CPE sedang terkunci. Tunggu sekitar ${waitSeconds} detik sebelum mencoba lagi.`);
    }

    try {
        return await getDataFromCPE();
    } catch (err) {
        const message = String(err.message || "");

        if (message.includes("sedang terkunci") || message.includes("Perangkat sedang menolak login")) {
            throw err;
        }

        console.log("Relogging in to CPE210...");
        try {
            await loginToCPE();
            return await getDataFromCPE();
        } catch (loginErr) {
            throw loginErr;
        }
    }
}

app.get("/api/cpe", requireAuth, async (req, res) => {
    try {
        const rawData = await getDataFromCPEWithLogin();
        latestCpeData = rawData;
        recordAntennaHistory(rawData);
        await saveAntennaDataToMongo(rawData);
        rawData.waterLevel = waterLevelState.level;
        rawData.waterDistance = waterLevelState.distance;
        rawData.waterStatus = waterLevelState.status;
        rawData.waterLastUpdated = waterLevelState.lastUpdated;
        rawData.motorPosition = motorState.position;
        rawData.packetLoss = extractPacketLossFromCpeData(rawData);
        rawData.packetLossSource = rawData.packetLoss !== null ? "cpe" : null;

        if (rawData.packetLoss === null) {
            const latestPingPacketLoss = getLatestPingPacketLoss();
            if (latestPingPacketLoss !== null) {
                rawData.packetLoss = latestPingPacketLoss;
                rawData.packetLossSource = "ping";
            }
        }

        // Auto-ping to get packet loss from network (non-blocking)
        // Try to ping the CPE/Mikrotik and extract packet loss
        if (rawData.packetLoss === null) {
            runPingTest(QOS_TARGET_HOST, 4).then((pingResult) => {
                if (pingResult && pingResult.packetLoss !== null) {
                    console.log(`Auto-ping packet loss: ${pingResult.packetLoss}%`);
                    addPingHistory(pingResult);
                }
            }).catch((err) => {
                // Silently fail; we already have antenna data
                console.debug("Auto-ping failed (non-critical):", err.message);
            });
        }

        res.json(rawData);
    } catch (err) {
        console.error("Error:", err.message);
        const latestPingPacketLoss = getLatestPingPacketLoss();

        if (latestPingPacketLoss === null) {
            runPingTest(QOS_TARGET_HOST, 4).then((pingResult) => {
                if (pingResult && pingResult.packetLoss !== null) {
                    console.log(`Auto-ping packet loss after CPE error: ${pingResult.packetLoss}%`);
                    addPingHistory(pingResult);
                }
            }).catch((pingErr) => {
                console.debug("Auto-ping after CPE error failed (non-critical):", pingErr.message);
            });
        }

        res.json({
            error: "Gagal ambil data dari CPE210",
            details: err.message,
            cpeBaseUrl: BASE_URL,
            cpeLockUntil: cpeLockUntil || null,
            cpeCookieConfigured: Boolean(CPE_COOKIE),
            packetLoss: latestPingPacketLoss,
            packetLossSource: latestPingPacketLoss !== null ? "ping" : null,
            waterLevel: waterLevelState.level,
            waterDistance: waterLevelState.distance,
            waterStatus: waterLevelState.status,
            waterLastUpdated: waterLevelState.lastUpdated,
            motorPosition: motorState.position
        });
    }
});

app.post("/api/motor", requireAuth, async (req, res) => {
    const { direction } = req.body;

    if (!direction || (direction !== "up" && direction !== "down")) {
        return res.status(400).json({ success: false, message: "Direction harus 'up' atau 'down'" });
    }

    if (motorState.isMoving) {
        return res.status(409).json({ success: false, message: "Motor masih bergerak, tunggu sebentar" });
    }

    const espCommand = direction === "up" ? "naik" : "turun";

    let newPosition = motorState.position;
    if (direction === "up") {
        newPosition = Math.min(motorState.position + MOTOR_STEP_INCREMENT, MOTOR_MAX_POSITION);
    } else {
        newPosition = Math.max(motorState.position - MOTOR_STEP_INCREMENT, MOTOR_MIN_POSITION);
    }

    try {
        const targetUrl = `${ESP32_BASE_URL}/control`;
        console.log(`Mengirim perintah motor ke ESP32: ${targetUrl}?cmd=${espCommand}`);

        await axios.get(`${ESP32_BASE_URL}/control`, {
            params: { cmd: espCommand },
            timeout: 3000
        });

        console.log(`ESP32 menerima perintah motor: ${espCommand}`);

        motorState.isMoving = true;
        motorState.direction = direction;
        addHistoryEvent("servo", {
            event: `Servo bergerak ${direction === "up" ? "naik" : "turun"}`,
            direction,
            command: espCommand,
            previousPosition: motorState.position,
            targetPosition: newPosition
        });

        setTimeout(() => {
            motorState.position = newPosition;
            motorState.isMoving = false;
            motorState.direction = null;
            console.log(`Motor moved ${direction} to position ${motorState.position}`);
        }, MOTOR_MOVE_DELAY);
    } catch (err) {
        return res.status(502).json({
            success: false,
            message: "Gagal mengirim perintah ke ESP32",
            details: err.message
        });
    }

    res.json({
        success: true,
        message: `Motor bergerak ${direction === "up" ? "naik" : "turun"}`,
        position: newPosition,
        direction
    });
});

app.get("/api/motor/status", requireAuth, (req, res) => {
    res.json({ success: true, motor: motorState, waterLevel: waterLevelState.level });
});

app.get("/api/history", requireAuth, (req, res) => {
    res.json({ success: true, history: historyState });
});

function generateSessionId() {
    return crypto.randomBytes(32).toString("hex");
}

async function startApp() {
    try {
        await connectMongo();
    } catch (err) {
        console.error("MongoDB gagal terhubung:", err.message);
        console.warn("Melanjutkan tanpa MongoDB. Login default masih tersedia, tetapi signup dinonaktifkan sampai MongoDB aktif.");
    }

    app.listen(PORT, () => {
        console.log(`Server berjalan di http://localhost:${PORT}`);
        console.log(`Endpoint ESP32: http://192.168.1.20:${PORT}/data`);
        console.log(`CPE base URL: ${BASE_URL}`);
        console.log(`CPE cookie configured: ${CPE_COOKIE ? "yes" : "no"}`);
        console.log("Auto-refresh data setiap 3 detik...");
        console.log("\nKredensial default:");
        console.log("   Username: admin");
        console.log("   Password: admin123");
        console.log("   atau");
        console.log("   Username: user");
        console.log("   Password: password123");
    });
}

startApp();
