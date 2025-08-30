const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const helmet = require("helmet");
const basicAuth = require("express-basic-auth");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// --- Security ---
app.use(helmet());
app.use(express.json());
const limiter = rateLimit({ windowMs: 60 * 1000, max: 100 });
app.use(limiter);

// --- Database setup ---
const db = new sqlite3.Database("raffle.db");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    result TEXT,
    time DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// --- Win probability (default 5%) ---
let winProb = process.env.WIN_PROB ? parseFloat(process.env.WIN_PROB) : 0.05;

// --- Static files ---
app.use(express.static("public"));

// --- API: Draw tickets ---
app.post("/api/draw", (req, res) => {
  const count = parseInt(req.query.count) || 1;
  const results = [];
  const stmt = db.prepare("INSERT INTO tickets (result) VALUES (?)");

  for (let i = 0; i < count; i++) {
    const result = Math.random() < winProb ? "carp" : "bream";
    results.push(result);
    stmt.run(result);
  }
  stmt.finalize();

  res.json({ results });
});

// --- Admin auth ---
app.use(
  "/admin",
  basicAuth({
    users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
    challenge: true,
  })
);

// --- Admin dashboard page ---
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// --- API: Admin list tickets ---
app.get("/api/admin/tickets", basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
  challenge: true,
}), (req, res) => {
  db.all("SELECT * FROM tickets ORDER BY time DESC LIMIT 50", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// --- API: Admin set probability ---
app.post("/api/admin/setprob", basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
  challenge: true,
}), (req, res) => {
  const newProb = req.body.prob;
  if (typeof newProb === "number" && newProb >= 0 && newProb <= 1) {
    winProb = newProb;
    return res.json({ ok: true, winProb });
  }
  res.status(400).json({ error: "Invalid probability" });
});
// --- API: Admin reset tickets ---
app.post("/api/admin/reset", basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
  challenge: true,
}), (req, res) => {
  db.run("DELETE FROM tickets", (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});
// --- Start server ---
app.listen(PORT, () => {
  console.log(`Tackle Tarts Giveaway running on port ${PORT}`);
});
