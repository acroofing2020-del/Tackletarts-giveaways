const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const session = require("express-session");
const path = require("path");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 10000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: true,
  })
);
app.use(express.static(path.join(__dirname, "public")));

// Database
const db = new sqlite3.Database("./database.sqlite", (err) => {
  if (err) console.error(err);
  else console.log("Connected to database.");
});

// Create tables
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      shipping_address TEXT
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      number INTEGER,
      is_winner INTEGER DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`
  );
});

// Helpers
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).send("Unauthorized");
  }
  next();
}

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Signup
app.post("/api/signup", async (req, res) => {
  const { email, password, shipping_address } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  db.run(
    "INSERT INTO users (email, password, shipping_address) VALUES (?, ?, ?)",
    [email, hashed, shipping_address],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(400).send("Email already exists.");
      }
      req.session.userId = this.lastID;
      res.sendStatus(200);
    }
  );
});

// Login
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
    if (!user) return res.status(400).send("Invalid credentials.");
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).send("Invalid credentials.");
    req.session.userId = user.id;
    res.sendStatus(200);
  });
});

// Checkout session
app.post("/api/checkout", requireLogin, async (req, res) => {
  const { quantity } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Raffle Ticket",
            },
            unit_amount: 100, // $1 per ticket
          },
          quantity,
        },
      ],
      success_url: `${req.protocol}://${req.get("host")}/success`,
      cancel_url: `${req.protocol}://${req.get("host")}/cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating checkout session.");
  }
});

// Webhook
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook error:", err.message);
      return res.sendStatus(400);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = 1; // TODO: tie back to logged-in user

      // Example: allocate random ticket
      const ticketNum = Math.floor(Math.random() * 200000) + 1;
      db.run(
        "INSERT INTO tickets (user_id, number) VALUES (?, ?)",
        [userId, ticketNum],
        (err) => {
          if (err) console.error("Error adding ticket:", err);
          else console.log("Ticket assigned:", ticketNum);
        }
      );
    }

    res.json({ received: true });
  }
);

// Success / Cancel routes
app.get("/success", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "success.html"));
});

app.get("/cancel", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "cancel.html"));
});

// Dashboard tickets
app.get("/api/tickets", requireLogin, (req, res) => {
  db.all("SELECT * FROM tickets WHERE user_id = ?", [req.session.userId], (err, rows) => {
    if (err) return res.status(500).send("Error fetching tickets.");
    res.json(rows);
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Tackle Tarts Giveaway running on port ${PORT}`);
});
