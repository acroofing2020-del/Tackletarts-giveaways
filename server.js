// server.js
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const bodyParser = require("body-parser");
const Stripe = require("stripe");
const cors = require("cors");

// ====== CONFIG ======
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL || "http://localhost:" + PORT;
const stripeSecret = process.env.STRIPE_SECRET_KEY; // set in Render
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET; // set in Render
const stripe = Stripe(stripeSecret);

// ====== APP ======
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: false,
  })
);

// ====== DB ======
const db = new sqlite3.Database("./tackletart.db", (err) => {
  if (err) console.error("DB error:", err);
  else console.log("✅ SQLite connected");
});

db.serialize(() => {
  // users
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      name TEXT,
      address TEXT,
      credit_cents INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0
    )
  `);

  // competitions
  db.run(`
    CREATE TABLE IF NOT EXISTS competitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      image_url TEXT,
      total_tickets INTEGER,
      price_pence INTEGER DEFAULT 25,
      status TEXT DEFAULT 'open', -- open|closed
      instant_win_count INTEGER DEFAULT 100,
      instant_win_numbers TEXT -- comma-separated list of ints
    )
  `);

  // tickets
  db.run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      competition_id INTEGER,
      ticket_number INTEGER,
      is_instant_win INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE (competition_id, ticket_number),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(competition_id) REFERENCES competitions(id)
    )
  `);

  // orders (for audit)
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      competition_id INTEGER,
      quantity INTEGER,
      amount_pence INTEGER,
      stripe_session_id TEXT,
      stripe_payment_intent TEXT,
      status TEXT DEFAULT 'created',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // seed admin (if env vars provided)
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    db.run(
      `INSERT OR IGNORE INTO users (email, password, is_admin) VALUES (?, ?, 1)`,
      [ADMIN_EMAIL, hash]
    );
  }
});

// ====== HELPERS ======
function loggedIn(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  next();
}
function adminOnly(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  db.get(`SELECT is_admin FROM users WHERE id = ?`, [req.session.userId], (e, row) => {
    if (e || !row || row.is_admin !== 1) return res.status(403).json({ error: "Admin only" });
    next();
  });
}
function sampleInstantWinNumbers(total, count) {
  // choose "count" unique numbers in [1..total], shuffled
  count = Math.min(count, total);
  const set = new Set();
  while (set.size < count) {
    set.add(1 + Math.floor(Math.random() * total));
  }
  return Array.from(set);
}

// ====== AUTH ======
app.post("/api/signup", (req, res) => {
  const { email, password, name, address } = req.body;
  if (!email || !password || !address) {
    return res.status(400).json({ error: "Email, password, and address are required" });
  }
  const hash = bcrypt.hashSync(password, 10);
  db.run(
    `INSERT INTO users (email, password, name, address) VALUES (?, ?, ?, ?)`,
    [email, hash, name || "", address],
    function (err) {
      if (err) return res.status(400).json({ error: "Email already registered" });
      req.session.userId = this.lastID;
      res.json({ success: true });
    }
  );
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
    if (err || !user) return res.status(400).json({ error: "Invalid login" });
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ error: "Invalid login" });
    }
    req.session.userId = user.id;
    res.json({ success: true });
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  db.get(
    `SELECT id, email, name, address, credit_cents, is_admin FROM users WHERE id = ?`,
    [req.session.userId],
    (err, row) => {
      res.json({ user: row || null });
    }
  );
});

// ====== COMPETITIONS ======
// Create competition (admin): precompute instant-win numbers
app.post("/api/admin/competitions", adminOnly, (req, res) => {
  const {
    title,
    description,
    image_url,
    total_tickets = 200000,
    price_pence = 25,
    instant_win_count = 100
  } = req.body;

  const wins = sampleInstantWinNumbers(total_tickets, instant_win_count).join(",");
  db.run(
    `INSERT INTO competitions
     (title, description, image_url, total_tickets, price_pence, status, instant_win_count, instant_win_numbers)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
    [title, description, image_url || "", total_tickets, price_pence, instant_win_count, wins],
    function (err) {
      if (err) return res.status(500).json({ error: "Failed to create competition" });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Close competition (admin)
app.post("/api/admin/competitions/:id/close", adminOnly, (req, res) => {
  db.run(`UPDATE competitions SET status='closed' WHERE id = ?`, [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Failed to close" });
    res.json({ success: true });
  });
});

app.get("/api/competitions", (req, res) => {
  db.all(`SELECT * FROM competitions WHERE status='open'`, (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to fetch competitions" });
    res.json(rows);
  });
});

// ====== CHECKOUT ======
app.post("/api/checkout", loggedIn, (req, res) => {
  const { competitionId, quantity } = req.body;
  if (!competitionId || !quantity || quantity < 1) {
    return res.status(400).json({ error: "competitionId and quantity required" });
  }

  db.get(`SELECT * FROM competitions WHERE id=? AND status='open'`, [competitionId], async (err, comp) => {
    if (err || !comp) return res.status(400).json({ error: "Competition not found or closed" });

    // Stripe session
    try {
      const origin = req.headers["x-forwarded-proto"]
        ? `${req.headers["x-forwarded-proto"]}://${req.get("host")}`
        : `${req.protocol}://${req.get("host")}`;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "gbp",
              product_data: { name: comp.title || `Competition #${comp.id}` },
              unit_amount: comp.price_pence
            },
            quantity
          }
        ],
        success_url: `${origin}/success.html`,
        cancel_url: `${origin}/cancel.html`,
        metadata: {
          userId: String(req.session.userId),
          competitionId: String(comp.id),
          quantity: String(quantity)
        }
      });

      // record order (created)
      db.run(
        `INSERT INTO orders (user_id, competition_id, quantity, amount_pence, stripe_session_id, status)
         VALUES (?, ?, ?, ?, ?, 'created')`,
        [req.session.userId, comp.id, quantity, comp.price_pence * quantity, session.id],
        () => {}
      );

      res.json({ url: session.url });
    } catch (e) {
      console.error("Stripe error:", e);
      res.status(500).json({ error: "Stripe failed" });
    }
  });
});

// ====== WEBHOOK (Stripe) ======
// IMPORTANT: raw body for Stripe signature check
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, stripeWebhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { userId, competitionId, quantity } = session.metadata || {};
    const qty = parseInt(quantity || "0", 10);

    if (!userId || !competitionId || !qty) {
      console.error("Missing metadata in session");
      res.json({ received: true });
      return;
    }

    // Fetch competition (for total + instant map)
    db.get(`SELECT * FROM competitions WHERE id=?`, [competitionId], (err, comp) => {
      if (err || !comp) {
        console.error("Competition not found in webhook");
        return;
      }

      const instantSet = new Set(
        (comp.instant_win_numbers || "")
          .split(",")
          .map((x) => parseInt(x, 10))
          .filter((x) => !isNaN(x))
      );

      // allocate unique random tickets + apply instant-win credits
      let assigned = 0;
      const assignOne = () => {
        if (assigned >= qty) {
          // mark order paid
          db.run(
            `UPDATE orders SET status='paid', stripe_payment_intent=? WHERE stripe_session_id=?`,
            [session.payment_intent || "", session.id],
            () => {}
          );
          return;
        }
        const n = 1 + Math.floor(Math.random() * comp.total_tickets);
        // try insert
        db.run(
          `INSERT INTO tickets (user_id, competition_id, ticket_number, is_instant_win)
           VALUES (?, ?, ?, ?)`,
          [userId, competitionId, n, instantSet.has(n) ? 1 : 0],
          function (e) {
            if (e) {
              // likely UNIQUE constraint -> try again
              return assignOne();
            }
            // if instant win -> add 20p credit
            if (instantSet.has(n)) {
              db.run(
                `UPDATE users SET credit_cents = credit_cents + 20 WHERE id = ?`,
                [userId],
                () => {}
              );
            }
            assigned++;
            assignOne();
          }
        );
      };
      assignOne();
    });
  }

  res.json({ received: true });
});

// ====== USER DASHBOARD ======
app.get("/api/my-tickets", loggedIn, (req, res) => {
  db.all(
    `SELECT t.id, t.ticket_number, t.is_instant_win, t.created_at,
            c.id as competition_id, c.title
     FROM tickets t JOIN competitions c ON t.competition_id = c.id
     WHERE t.user_id = ?
     ORDER BY t.created_at DESC`,
    [req.session.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Failed to load tickets" });
      db.get(`SELECT credit_cents FROM users WHERE id=?`, [req.session.userId], (e, u) => {
        res.json({ tickets: rows || [], credit_cents: (u && u.credit_cents) || 0 });
      });
    }
  );
});

// ====== STATIC ROUTES ======
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/success", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "success.html"))
);
app.get("/cancel", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "cancel.html"))
);

// ====== START ======
app.listen(PORT, () => {
  console.log(`🎣 TackleTart Giveaways running on port ${PORT}`);
  console.warn(
    "Warning: express-session MemoryStore is not designed for production scale. Use Redis in production."
  );
});

// NOTE for Render: In your service settings, set environment variables:
// - STRIPE_SECRET_KEY
// - STRIPE_WEBHOOK_SECRET
// - BASE_URL (e.g., https://tackletarts-giveaways.onrender.com)
// - SESSION_SECRET (any long random string)
// - ADMIN_EMAIL (optional)
// - ADMIN_PASSWORD (optional)
