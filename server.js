const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const cors = require("cors");
const path = require("path");
const Stripe = require("stripe");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: false,
  })
);

// ================= DB SETUP =================
const db = new sqlite3.Database("./database.db", (err) => {
  if (err) console.error("❌ DB Connection failed:", err);
  else console.log("✅ Connected to SQLite database");
});

// Create tables if they don’t exist
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      name TEXT,
      address TEXT
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS competitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      totalTickets INTEGER,
      price REAL,
      instantWins INTEGER DEFAULT 0
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      competitionId INTEGER,
      ticketNumber INTEGER,
      isWinner INTEGER DEFAULT 0,
      FOREIGN KEY(userId) REFERENCES users(id),
      FOREIGN KEY(competitionId) REFERENCES competitions(id)
    )`
  );
});

// ================= AUTH ROUTES =================
app.post("/api/signup", (req, res) => {
  const { email, password, name, address } = req.body;
  const hashedPassword = bcrypt.hashSync(password, 10);

  db.run(
    `INSERT INTO users (email, password, name, address) VALUES (?, ?, ?, ?)`,
    [email, hashedPassword, name, address],
    function (err) {
      if (err) {
        return res.status(400).json({ error: "User already exists" });
      }
      res.json({ success: true, userId: this.lastID });
    }
  );
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
    if (err || !user) return res.status(400).json({ error: "Invalid login" });

    if (bcrypt.compareSync(password, user.password)) {
      req.session.userId = user.id;
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Invalid login" });
    }
  });
});

// ================= COMPETITIONS =================
app.post("/api/competitions", (req, res) => {
  const { title, description, totalTickets, price, instantWins } = req.body;
  db.run(
    `INSERT INTO competitions (title, description, totalTickets, price, instantWins) VALUES (?, ?, ?, ?, ?)`,
    [title, description, totalTickets, price, instantWins || 0],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, competitionId: this.lastID });
    }
  );
});

app.get("/api/competitions", (req, res) => {
  db.all(`SELECT * FROM competitions`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ================= STRIPE CHECKOUT =================
app.post("/api/checkout", async (req, res) => {
  const { competitionId, quantity } = req.body;

  db.get(`SELECT * FROM competitions WHERE id = ?`, [competitionId], async (err, comp) => {
    if (err || !comp) return res.status(400).json({ error: "Competition not found" });

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "gbp",
              product_data: {
                name: comp.title,
              },
              unit_amount: Math.round(comp.price * 100),
            },
            quantity,
          },
        ],
        mode: "payment",
        success_url: process.env.BASE_URL + "/success.html",
        cancel_url: process.env.BASE_URL + "/cancel.html",
      });

      res.json({ id: session.id });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
});

// ================= SERVER START =================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🎣 Tackle Tarts running on port ${PORT}`);
});
