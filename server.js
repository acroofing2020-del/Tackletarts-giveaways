const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 10000;

// ===== Stripe =====
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// --- RAW body for Stripe webhook must be BEFORE express.json() ---
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    const compId = parseInt(s.metadata.compId, 10);
    const email = s.metadata.userEmail;
    const qty = parseInt(s.metadata.quantity || "1", 10);

    const comp = competitions.find(c => c.id === compId);
    if (!comp || comp.ended) return res.json({ received: true });

    // Issue qty tickets
    for (let i = 0; i < qty; i++) {
      if (comp.soldCount >= comp.maxTickets) break;
      const ticketNumber = ++comp.soldCount;
      const result = comp.instantWins.includes(ticketNumber) ? "carp" : "bream";
      const t = { email, number: ticketNumber, result };
      comp.tickets.push(t);
      tickets.push({ userEmail: email, compId, number: ticketNumber, result });
    }
    console.log(`✅ Issued ${qty} ticket(s) to ${email} for comp ${compId}`);
  }

  res.json({ received: true });
});

// ===== Normal middleware after webhook =====
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "tackletarts-secret",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(express.static(path.join(__dirname, "public")));

// ===== In-memory data =====
// users: { email, password(hash), name, address1, address2, city, postcode, country, creditCents }
let users = [];
// competitions: { id, name, description, image, maxTickets, soldCount, instantWins[], tickets[], ended, winner }
let competitions = [];
// tickets: { userEmail, compId, number, result }
let tickets = [];

// ===== Helpers =====
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ message: "Login required" });
  next();
}
function getPriceCents() {
  const v = parseInt(process.env.TICKET_PRICE_CENTS || "500", 10);
  return Number.isFinite(v) ? v : 500; // default £5.00
}
function currency() {
  return "gbp"; // change to "usd" if you prefer USD
}
function findUser(email) {
  return users.find(u => u.email.toLowerCase() === String(email).toLowerCase());
}

// ===== AUTH =====
app.post("/api/signup", async (req, res) => {
  const { email, password, name, address1, address2, city, postcode, country } = req.body;
  if (findUser(email)) return res.status(400).json({ message: "User exists" });
  const hash = await bcrypt.hash(password, 10);
  users.push({
    email,
    password: hash,
    name, address1, address2, city, postcode, country,
    creditCents: 0
  });
  req.session.user = { email };
  res.json({ message: "Signup successful" });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const u = findUser(email);
  if (!u) return res.status(400).json({ message: "Invalid email" });
  const ok = await bcrypt.compare(password, u.password);
  if (!ok) return res.status(400).json({ message: "Invalid password" });
  req.session.user = { email: u.email };
  res.json({ message: "Login successful" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ message: "Logged out" }));
});

app.get("/api/me", requireLogin, (req, res) => {
  const u = findUser(req.session.user.email);
  const { email, name, address1, address2, city, postcode, country, creditCents } = u;
  res.json({ email, name, address1, address2, city, postcode, country, creditCents });
});

// ===== ADMIN =====
// Create competition
app.post("/api/admin/competitions", (req, res) => {
  const { name, description, image, maxTickets } = req.body;
  const id = competitions.length + 1;
  const total = parseInt(maxTickets || 200000, 10);

  // Pre-pick 100 instant wins (cap to total)
  const wins = new Set();
  while (wins.size < Math.min(100, total)) {
    wins.add(Math.floor(Math.random() * total) + 1);
  }

  const comp = {
    id, name, description, image,
    maxTickets: total,
    soldCount: 0,
    instantWins: [...wins],
    tickets: [],
    ended: false,
    winner: null
  };
  competitions.push(comp);
  res.json({ message: "Competition created", comp });
});

// Add more instant-win numbers
app.post("/api/admin/competitions/:id/add-instant-wins", (req, res) => {
  const comp = competitions.find(c => c.id == req.params.id);
  if (!comp) return res.status(404).json({ message: "Not found" });
  const nums = Array.isArray(req.body.numbers) ? req.body.numbers : [];
  const valid = nums
    .map(n => parseInt(n, 10))
    .filter(n => Number.isFinite(n) && n >= 1 && n <= comp.maxTickets);
  const set = new Set(comp.instantWins);
  valid.forEach(n => set.add(n));
  comp.instantWins = [...set];
  res.json({ message: "Instant wins updated", instantWinsCount: comp.instantWins.length });
});

// Grant credit to a user (cents)
app.post("/api/admin/credit/grant", (req, res) => {
  const { email, amountCents } = req.body;
  const u = findUser(email);
  if (!u) return res.status(404).json({ message: "User not found" });
  const amt = parseInt(amountCents, 10);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ message: "Invalid amount" });
  u.creditCents += amt;
  res.json({ message: "Credit granted", creditCents: u.creditCents });
});

// Assign FREE tickets to a user (no payment)
app.post("/api/admin/tickets/assign-free", (req, res) => {
  const { email, compId, numbers } = req.body;
  const u = findUser(email);
  const comp = competitions.find(c => c.id == compId);
  if (!u || !comp) return res.status(400).json({ message: "Invalid user/comp" });

  const nums = Array.isArray(numbers) ? numbers : [];
  const assigned = [];
  for (const n of nums) {
    const num = parseInt(n, 10);
    if (!Number.isFinite(num) || num < 1 || num > comp.maxTickets) continue;
    // Only assign if not already sold/assigned
    const exists = comp.tickets.some(t => t.number === num);
    if (exists) continue;

    // Adjust soldCount if assigning beyond current soldCount
    if (num > comp.soldCount) comp.soldCount = num;
    const result = comp.instantWins.includes(num) ? "carp" : "bream";
    const t = { email: u.email, number: num, result };
    comp.tickets.push(t);
    tickets.push({ userEmail: u.email, compId: comp.id, number: num, result });
    assigned.push(num);
  }
  res.json({ message: "Free tickets assigned", assigned });
});

// Edit a ticket result manually (e.g., set to carp/bream/winner)
app.post("/api/admin/tickets/edit", (req, res) => {
  const { compId, number, result } = req.body;
  const comp = competitions.find(c => c.id == compId);
  if (!comp) return res.status(404).json({ message: "Comp not found" });
  const t = comp.tickets.find(tt => tt.number == number);
  if (!t) return res.status(404).json({ message: "Ticket not found" });
  if (!["bream", "carp", "winner"].includes(result)) {
    return res.status(400).json({ message: "Invalid result" });
  }
  t.result = result;
  const global = tickets.find(tt => tt.compId == compId && tt.number == number && tt.userEmail === t.email);
  if (global) global.result = result;
  res.json({ message: "Ticket updated", ticket: t });
});

// End competition (random final draw)
app.post("/api/admin/end/:id", (req, res) => {
  const comp = competitions.find(c => c.id == req.params.id);
  if (!comp || comp.ended) return res.status(400).json({ message: "Invalid comp" });
  if (comp.tickets.length === 0) return res.status(400).json({ message: "No tickets sold" });

  const w = comp.tickets[Math.floor(Math.random() * comp.tickets.length)];
  comp.ended = true;
  comp.winner = w;

  // Mark winner on that ticket
  w.result = "winner";
  const global = tickets.find(tt => tt.compId == comp.id && tt.number == w.number && tt.userEmail === w.email);
  if (global) global.result = "winner";

  res.json({ message: "Competition ended", winner: w });
});

// ===== PUBLIC / USER =====
app.get("/api/competitions", (req, res) => {
  res.json(competitions.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    image: c.image,
    maxTickets: c.maxTickets,
    soldCount: c.soldCount,
    ended: c.ended,
    winner: c.winner
  })));
});

// Stripe checkout (paid) with quantity
app.post("/api/checkout/:id", requireLogin, async (req, res) => {
  const comp = competitions.find(c => c.id == req.params.id);
  if (!comp || comp.ended) return res.status(400).json({ message: "Invalid competition" });
  const qty = Math.max(1, Math.min(parseInt(req.body?.quantity || "1", 10), 50));
  if (comp.soldCount + qty > comp.maxTickets) return res.status(400).json({ message: "Not enough tickets left" });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{
        price_data: {
          currency: currency(),
          unit_amount: getPriceCents(),
          product_data: { name: comp.name, description: comp.description }
        },
        quantity: qty
      }],
      success_url: `${process.env.APP_BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL}/cancel.html`,
      metadata: {
        compId: String(comp.id),
        userEmail: req.session.user.email,
        quantity: String(qty)
      }
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ message: "Payment error" });
  }
});

// Buy with site credit (no Stripe)
app.post("/api/credit/buy/:id", requireLogin, (req, res) => {
  const comp = competitions.find(c => c.id == req.params.id);
  if (!comp || comp.ended) return res.status(400).json({ message: "Invalid competition" });
  const qty = Math.max(1, Math.min(parseInt(req.body?.quantity || "1", 10), 50));
  if (comp.soldCount + qty > comp.maxTickets) return res.status(400).json({ message: "Not enough tickets left" });

  const u = findUser(req.session.user.email);
  const cost = getPriceCents() * qty;
  if (u.creditCents < cost) return res.status(400).json({ message: "Not enough credit" });

  u.creditCents -= cost;
  const issued = [];
  for (let i = 0; i < qty; i++) {
    const ticketNumber = ++comp.soldCount;
    const result = comp.instantWins.includes(ticketNumber) ? "carp" : "bream";
    const t = { email: u.email, number: ticketNumber, result };
    comp.tickets.push(t);
    tickets.push({ userEmail: u.email, compId: comp.id, number: ticketNumber, result });
    issued.push({ number: ticketNumber, result });
  }
  res.json({ message: "Tickets issued from credit", issued, creditCents: u.creditCents });
});

// User’s tickets
app.get("/api/mytickets", requireLogin, (req, res) => {
  const my = tickets
    .filter(t => t.userEmail === req.session.user.email)
    .map(t => {
      const comp = competitions.find(c => c.id === t.compId);
      return {
        competitionName: comp?.name || "Unknown",
        image: comp?.image || "",
        number: t.number,
        result: t.result
      };
    });
  res.json(my);
});

// ===== START =====
app.listen(PORT, () => console.log(`🎣 Tackle Tarts running on port ${PORT}`));
