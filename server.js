const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const bodyParser = require("body-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 10000;

// SQLite setup
const db = new sqlite3.Database("./database.sqlite", (err) => {
  if (err) console.error(err.message);
  else console.log("✅ Connected to SQLite database.");
});

// Create tables if not exists
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      address TEXT,
      is_admin INTEGER DEFAULT 0
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      competition_id INTEGER,
      ticket_number INTEGER,
      instant_win INTEGER DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS competitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      total_tickets INTEGER,
      price_per_ticket REAL,
      active INTEGER DEFAULT 1
    )`
  );
});

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: false,
  })
);

// 🔑 Auto-create admin account if not exists
const seedAdmin = async () => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.warn("⚠️ ADMIN_EMAIL or ADMIN_PASSWORD not set in environment variables.");
    return;
  }

  db.get("SELECT * FROM users WHERE email = ?", [adminEmail], async (err, row) => {
    if (err) return console.error(err.message);

    if (!row) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      db.run(
        "INSERT INTO users (email, password, is_admin) VALUES (?, ?, 1)",
        [adminEmail, hashedPassword],
        (err) => {
          if (err) console.error("❌ Error seeding admin:", err.message);
          else console.log("✅ Admin user created:", adminEmail);
        }
      );
    } else {
      console.log("ℹ️ Admin user already exists:", adminEmail);
    }
  });
};
seedAdmin();

// Routes
app.post("/api/signup", async (req, res) => {
  const { email, password, address } = req.body;
  if (!email || !password || !address) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  db.run(
    "INSERT INTO users (email, password, address) VALUES (?, ?, ?)",
    [email, hashedPassword, address],
    function (err) {
      if (err) return res.status(400).json({ error: "User already exists" });
      res.json({ id: this.lastID, email });
    }
  );
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
    if (err || !user) return res.status(401).json({ error: "Invalid login" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Invalid login" });

    req.session.user = { id: user.id, email: user.email, is_admin: user.is_admin };
    res.json({ message: "Login successful", user: req.session.user });
  });
});

app.get("/api/me", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  res.json(req.session.user);
});

// Example protected admin route
app.get("/api/admin/competitions", (req, res) => {
  if (!req.session.user || !req.session.user.is_admin) {
    return res.status(403).json({ error: "Forbidden" });
  }

  db.all("SELECT * FROM competitions", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🎣 TackleTarts running on port ${PORT}`);
});
