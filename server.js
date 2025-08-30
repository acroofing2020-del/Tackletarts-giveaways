// server.js
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const basicAuth = require("express-basic-auth");

const app = express();
const PORT = process.env.PORT || 10000;

// ==== CONFIG ====
const MAX_TICKETS = 200000; // total entries
const WIN_NUMBERS = [77777, 150000]; // 🎣 Carp winning tickets

// ==== MIDDLEWARE ====
app.use(bodyParser.json());
app.use(
  session({
    secret: "tackle-tarts-secret",
    resave: false,
    saveUninitialized: true,
  })
);
app.use(express.static("public"));

// ==== DATABASE ====
const db = new sqlite3.Database("./raffle.db");

// create tables if not exist
db.serialize(() => {
  db.run(
    "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT, password TEXT)"
  );
  db.run(
    "CREATE TABLE IF NOT EXISTS competitions (id INTEGER PRIMARY KEY, name TEXT, description TEXT, image TEXT, active INTEGER)"
  );
  db.run(
    "CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY, email TEXT, competition TEXT, result TEXT, number INTEGER, time TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
  );
});

// ==== ROUTES ====

// signup
app.post("/api/signup", (req, res) => {
  const { email, password } = req.body;
  db.run(
    "INSERT INTO users (email, password) VALUES (?, ?)",
    [email, password],
    function (err) {
      if (err) return res.status(500).send("Signup error");
      res.json({ success: true });
    }
  );
});

// login
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  db.get(
    "SELECT * FROM users WHERE email = ? AND password = ?",
    [email, password],
    (err, row) => {
      if (row) {
        req.session.user = row;
        res.json({ success: true });
      } else {
        res.status(401).send("Invalid credentials");
      }
    }
  );
});

// get competitions
app.get("/api/competitions", (req, res) => {
  db.all("SELECT * FROM competitions WHERE active = 1", (err, rows) => {
    res.json(rows);
  });
});

// enter competition
app.post("/api/enter", (req, res) => {
  const comp = req.body.competition;
  const user = req.session.user ? req.session.user.email : "Guest";

  // assign random ticket number
  const ticketNumber = Math.floor(Math.random() * MAX_TICKETS) + 1;

  // check if it's a winning ticket
  const result = WIN_NUMBERS.includes(ticketNumber) ? "Carp" : "Bream";

  db.run(
    "INSERT INTO tickets (email, competition, result, number) VALUES (?, ?, ?, ?)",
    [user, comp, result, ticketNumber],
    function (err) {
      if (err) return res.status(500).send("DB error");
      res.json({ ticket: ticketNumber, result });
    }
  );
});

// ==== ADMIN ====
app.use(
  "/api/admin",
  basicAuth({
    users: { [process.env.ADMIN_USER || "admin"]: process.env.ADMIN_PASS || "password" },
    challenge: true,
  })
);

// view tickets
app.get("/api/admin/tickets", (req, res) => {
  db.all("SELECT * FROM tickets ORDER BY time DESC LIMIT 50", (err, rows) => {
    res.json(rows);
  });
});

// reset tickets
app.post("/api/admin/reset", (req, res) => {
  db.run("DELETE FROM tickets", () => res.json({ success: true }));
});

// competitions management
app.get("/api/admin/competitions", (req, res) => {
  db.all("SELECT * FROM competitions", (err, rows) => res.json(rows));
});

app.post("/api/admin/competitions", (req, res) => {
  const { name, description, image } = req.body;
  db.run(
    "INSERT INTO competitions (name, description, image, active) VALUES (?, ?, ?, 1)",
    [name, description, image],
    () => res.json({ success: true })
  );
});

app.post("/api/admin/competitions/:id/toggle", (req, res) => {
  db.get("SELECT active FROM competitions WHERE id = ?", [req.params.id], (err, row) => {
    const newVal = row.active ? 0 : 1;
    db.run("UPDATE competitions SET active = ? WHERE id = ?", [newVal, req.params.id], () =>
      res.json({ success: true })
    );
  });
});

app.delete("/api/admin/competitions/:id", (req, res) => {
  db.run("DELETE FROM competitions WHERE id = ?", [req.params.id], () =>
    res.json({ success: true })
  );
});

// ==== START ====
app.listen(PORT, () => {
  console.log(`Tackle Tarts Giveaway running on port ${PORT}`);
});
