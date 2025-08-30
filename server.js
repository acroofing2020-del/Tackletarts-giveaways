const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const basicAuth = require("express-basic-auth");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

// Database
const db = new sqlite3.Database("./raffle.db");

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, password TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY, user_id INTEGER, competition TEXT, result TEXT, time DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS competitions (id INTEGER PRIMARY KEY, name TEXT, description TEXT, image TEXT, active INTEGER)");
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  store: new SQLiteStore({ db: "sessions.db", dir: "./" }),
  secret: process.env.SESSION_SECRET || "secret",
  resave: false,
  saveUninitialized: false
}));
app.use(express.static(path.join(__dirname, "public")));

// Auth middleware
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login.html");
  next();
}

const adminAuth = basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
  challenge: true
});

// --- Routes ---

// Signup
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).send("Missing fields");
  const hash = await bcrypt.hash(password, 10);
  db.run("INSERT INTO users (email, password) VALUES (?, ?)", [email, hash], function(err) {
    if (err) return res.status(500).send("User exists or DB error");
    req.session.userId = this.lastID;
    req.session.email = email;
    res.redirect("/competitions.html");
  });
});

// Login
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, row) => {
    if (err || !row) return res.status(400).send("Invalid login");
    const match = await bcrypt.compare(password, row.password);
    if (!match) return res.status(400).send("Invalid login");
    req.session.userId = row.id;
    req.session.email = row.email;
    res.redirect("/competitions.html");
  });
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login.html");
  });
});

// Get active competitions
app.get("/api/competitions", (req, res) => {
  db.all("SELECT * FROM competitions WHERE active = 1", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Enter competition
app.post("/api/enter", requireLogin, (req, res) => {
  const { competition } = req.body;
  const winProb = parseFloat(process.env.WIN_PROB || 0.05);
  const result = Math.random() < winProb ? "Carp" : "Bream";
  db.run("INSERT INTO tickets (user_id, competition, result) VALUES (?, ?, ?)", 
    [req.session.userId, competition, result], 
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ result });
    });
});

// --- Admin Routes ---
app.get("/admin", adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/api/admin/tickets", adminAuth, (req, res) => {
  db.all("SELECT t.id, u.email, t.competition, t.result, t.time FROM tickets t LEFT JOIN users u ON t.user_id = u.id ORDER BY t.time DESC LIMIT 50", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/admin/reset", adminAuth, (req, res) => {
  db.run("DELETE FROM tickets", err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

app.post("/api/admin/setprob", adminAuth, (req, res) => {
  process.env.WIN_PROB = req.body.prob;
  res.json({ ok: true });
});

// Admin competitions
app.get("/api/admin/competitions", adminAuth, (req, res) => {
  db.all("SELECT * FROM competitions", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/admin/competitions", adminAuth, (req, res) => {
  const { name, description, image } = req.body;
  if (!name || !description || !image) return res.status(400).json({ error: "Missing fields" });
  db.run("INSERT INTO competitions (name, description, image, active) VALUES (?, ?, ?, 1)", 
    [name, description, image], 
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, id: this.lastID });
    });
});

app.post("/api/admin/competitions/:id/toggle", adminAuth, (req, res) => {
  db.run("UPDATE competitions SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

app.delete("/api/admin/competitions/:id", adminAuth, (req, res) => {
  db.run("DELETE FROM competitions WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Tackle Tarts Giveaway running on port ${PORT}`);
});
