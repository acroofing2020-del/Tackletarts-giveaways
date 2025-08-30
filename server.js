const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 10000;

// ===== Stripe =====
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// We must read the webhook raw body BEFORE JSON middleware
app.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
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
      console.error("⚠️  Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle successful checkout
    if (event.type === "checkout.session.completed") {
      const sessionObj = event.data.object;

      const compId = parseInt(sessionObj.metadata.compId, 10);
      const userEmail = sessionObj.metadata.userEmail;

      const comp = competitions.find((c) => c.id === compId);
      if (!comp || comp.ended) {
        console.warn("Webhook: invalid or ended competition", compId);
        return res.json({ received: true });
      }

      if (comp.soldCount >= comp.maxTickets) {
        console.warn("Webhook: sold out for comp", compId);
        return res.json({ received: true });
      }

      // Assign next ticket number
      const ticketNumber = comp.soldCount + 1;
      comp.soldCount++;

      const result = comp.instantWins.includes(ticketNumber) ? "carp" : "bream";

      comp.tickets.push({ email: userEmail, number: ticketNumber, result });
      tickets.push({
        userEmail,
        compId,
        number: ticketNumber,
        result,
      });

      console.log(
        `✅ Ticket issued via webhook: comp ${compId} #${ticketNumber} -> ${userEmail} (${result})`
      );
    }

    res.json({ received: true });
  }
);

// ===== Normal middleware (after webhook raw) =====
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "tackletarts-secret",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(express.static(path.join(__dirname, "public")));

// ===== In-memory data (replace with DB later) =====
let users = []; // { email, password: hash }
let competitions = []; // { id, name, description, image, maxTickets, soldCount, instantWins[], tickets[], ended, winner }
let tickets = []; // { userEmail, compId, number, result }

// ===== Helpers =====
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ message: "Login required" });
  next();
}
function getPriceCents() {
  const v = parseInt(process.env.TICKET_PRICE_CENTS || "500", 10);
  return Number.isFinite(v) ? v : 500;
}
function gbpOrUsd() {
  // If you want GBP (UK), use 'gbp'; change to 'usd' if needed.
  return "gbp";
}

// ===== AUTH =====
app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (users.find((u) => u.email === email)) {
    return res.status(400).json({ message: "User exists" });
  }
  const hash = await bcrypt.hash(password, 10);
  users.push({ email, password: hash });
  req.session.user = { email };
  res.json({ message: "Signup successful" });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = users.find((u) => u.email === email);
  if (!user) return res.status(400).json({ message: "Invalid email" });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ message: "Invalid password" });
  req.session.user = { email };
  res.json({ message: "Login successful" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ message: "Logged out" }));
});

// ===== ADMIN =====
app.post("/api/admin/competitions", (req, res) => {
  const { name, description, image, maxTickets } = req.body;
  const id = competitions.length + 1;
  const totalTickets = parseInt(maxTickets || 200000, 10);

  // Pre-pick 100 instant win ticket numbers (Carp)
  const wins = new Set();
  while (wins.size < 100 && wins.size < totalTickets) {
    wins.add(Math.floor(Math.random() * totalTickets) + 1);
  }

  const comp = {
    id,
    name,
    description,
    image,
    maxTickets: totalTickets,
    soldCount: 0,
    instantWins: [...wins],
    tickets: [],
    ended: false,
    winner: null,
  };

  competitions.push(comp);
  res.json({ message: "Competition created", comp });
});

app.post("/api/admin/end/:id", (req, res) => {
  const comp = competitions.find((c) => c.id == req.params.id);
  if (!comp || comp.ended) return res.status(400).json({ message: "Invalid comp" });
  if (comp.tickets.length === 0) return res.status(400).json({ message: "No tickets sold" });

  const w = comp.tickets[Math.floor(Math.random() * comp.tickets.length)];
  comp.ended = true;
  comp.winner = w;
  res.json({ message: "Competition ended", winner: w });
});

// ===== PUBLIC / USER =====
app.get("/api/competitions", (req, res) => {
  res.json(
    competitions.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      image: c.image,
      maxTickets: c.maxTickets,
      soldCount: c.soldCount,
      ended: c.ended,
      winner: c.winner,
    }))
  );
});

// Create Stripe Checkout Session (does NOT issue a ticket yet)
app.post("/api/checkout/:id", requireLogin, async (req, res) => {
  const comp = competitions.find((c) => c.id == req.params.id);
  if (!comp || comp.ended) return res.status(400).json({ message: "Invalid competition" });
  if (comp.soldCount >= comp.maxTickets) return res.status(400).json({ message: "Sold out" });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: gbpOrUsd(),
            unit_amount: getPriceCents(),
            product_data: {
              name: comp.name,
              description: comp.description,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.APP_BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL}/cancel.html`,
      metadata: {
        compId: String(comp.id),
        userEmail: req.session.user.email,
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe create session error:", err);
    res.status(500).json({ message: "Payment error" });
  }
});

// User tickets for dashboard cards
app.get("/api/mytickets", (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: "Login required" });

  const my = tickets
    .filter((t) => t.userEmail === req.session.user.email)
    .map((t) => {
      const comp = competitions.find((c) => c.id === t.compId);
      return {
        competitionName: comp?.name || "Unknown",
        image: comp?.image || "",
        number: t.number,
        result: t.result, // 'carp' or 'bream'
      };
    });

  res.json(my);
});

// ===== START =====
app.listen(PORT, () =>
  console.log(`🎣 Tackle Tarts running on http://localhost:${PORT}`)
);
