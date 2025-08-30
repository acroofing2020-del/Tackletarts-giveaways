const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const helmet = require("helmet");
const basicAuth = require("express-basic-auth");
const rateLimit = require("express-rate-limit");
const path = require("path");
const bcrypt = require("bcrypt");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);

const app = express();
const PORT = process.env.PORT || 10000;

// --- Security & Middleware ---
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.db", dir: "./" }),
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: false,
  })
);

const limiter = rateLimit({ windowMs: 60 * 1000, max: 100 });
app.use(limiter);

// --- Database setup ---
const db = new sqlite3.Database("raffle.db");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    result TEXT,
    time DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    passwordHash TEXT
  )`);
});

// --- Win probability (default 5%) ---
let winProb = process.env.WIN_PROB ? parseFloat(process.env.WIN_PROB) : 0.05;

// --- Static files ---
app.use(express.static("public"));

// --- Middleware: Check logged in ---
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  next();
}

// --- API: Signup ---
app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Missing fields" });

  const passwordHash = await bcrypt.hash(password, 10);
  db.run(
    "INSERT INTO users (email, passwordHash) VALUES (?, ?)",
    [email, passwordHash],
    function (err) {
      if (err) return res.status(400).json({ error: "User already exists" });
      req.session.userId = this.lastID;
      res.json({ ok: true, userId: this.lastID });
    }
  );
});

// --- API: Login ---
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Missing fields" });

  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
    if (err || !user) return res.status(401).json({ error: "Invalid login" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: "Invalid login" });

    req.session.userId = user.id;
    res.json({ ok: true, userId: user.id });
  });
});

// --- API: Logout ---
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// --- API: Draw tickets (must be logged in) ---
app.post("/api/draw", requireLogin, (req, res) => {
  const count = parseInt(req.query.count) || 1;
  const results = [];

  const stmt = db.prepare(
    "INSERT INTO tickets (user_id, result) VALUES (?, ?)"
  );

  let completed = 0;
  for (let i = 0; i < count; i++) {
    const result = Math.random() < winProb ? "carp" : "bream";
    stmt.run(req.session.userId, result, function (err) {
      completed++;
      if (!err) {
        results.push({ ticketId: this.lastID, result });
      }
      if (completed === count) {
        res.json({ results });
      }
    });
  }

  stmt.finalize();
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
app.get(
  "/api/admin/tickets",
  basicAuth({
    users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
    challenge: true,
  }),
  (req, res) => {
    db.all(
      `SELECT tickets.id, users.email, tickets.result, tickets.time
       FROM tickets LEFT JOIN users ON tickets.user_id = users.id
       ORDER BY time DESC LIMIT 50`,
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
      }
    );
  }
);

// --- API: Admin set probability ---
app.post(
  "/api/admin/setprob",
  basicAuth({
    users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
    challenge: true,
  }),
  (req, res) => {
    const newProb = req.body.prob;
    if (typeof newProb === "number" && newProb >= 0 && newProb <= 1) {
      winProb = newProb;
      return res.json({ ok: true, winProb });
    }
    res.status(400).json({ error: "Invalid probability" });
  }
);

// --- API: Admin reset tickets ---
app.post(
  "/api/admin/reset",
  basicAuth({
    users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
    challenge: true,
  }),
  (req, res) => {
    db.run("DELETE FROM tickets", (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true });
    });
  }
);

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Tackle Tarts Giveaway running on port ${PORT}`);
});
