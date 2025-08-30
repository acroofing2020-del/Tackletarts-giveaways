const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const basicAuth = require("express-basic-auth");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// Env variables
const PORT = process.env.PORT || 8080;
const WIN_PROB = parseFloat(process.env.WIN_PROB || "0.05");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "change-me";

// Setup app
const app = express();
app.use(helmet());
app.use(express.json());
app.use(express.static("public"));

// Rate limiter (100 requests / 15 minutes per IP)
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Database setup
const db = new sqlite3.Database("data.db");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    result TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Serve main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API: draw tickets
app.post("/api/draw", (req, res) => {
  let draws = parseInt(req.query.count || "1");
  if (draws > 10) draws = 10;

  const results = [];
  for (let i = 0; i < draws; i++) {
    const isWin = Math.random() < WIN_PROB;
    const ticket = isWin ? "carp" : "bream";
    results.push(ticket);

    db.run("INSERT INTO tickets (result) VALUES (?)", [ticket]);
  }

  res.json({ results });
});

// Admin area
app.use(
  "/admin",
  basicAuth({
    users: { [ADMIN_USER]: ADMIN_PASS },
    challenge: true
  }),
  express.static("admin")
);

// API: get winners
app.get("/api/winners", (req, res) => {
  db.all(
    "SELECT * FROM tickets WHERE result='carp' ORDER BY created_at DESC",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Start server
app.listen(PORT, () => {
  console.log(`🎣 Tackle Tarts Giveaway running on port ${PORT}`);
});
