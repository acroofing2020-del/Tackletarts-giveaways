const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs"); // no native build needed
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// ===== App middleware =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret-key",
    resave: false,
    saveUninitialized: false,
  })
);

// ===== In-memory data (clears on restart) =====
let users = [];        // { id, email, passwordHash }
let competitions = []; // { id, name, description, image, maxTickets, soldTickets[], instantWins[], endWinner }
let tickets = [];      // { id, userId, compId, number, result }

// ===== Helpers =====
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  next();
}

function requireAdmin(req, res, next) {
  const key = req.header("x-admin-key") || req.query.key || req.body.key;
  const ADMIN_KEY = process.env.ADMIN_KEY || "changeme";
  if (key !== ADMIN_KEY) return res.status(403).json({ error: "Forbidden (bad admin key)" });
  next();
}

function pickUniqueRandomTicket(max, takenSet) {
  // Try randoms until we hit a free number (works fine until very high sell-through)
  let n;
  do {
    n = Math.floor(Math.random() * max) + 1; // 1..max
  } while (takenSet.has(n));
  return n;
}

// ===== Auth =====
app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  if (users.find(u => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(400).json({ error: "Email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: users.length + 1, email, passwordHash };
  users.push(user);
  req.session.userId = user.id;
  res.json({ message: "User created", user: { id: user.id, email: user.email } });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = users.find(u => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: "Invalid credentials" });

  req.session.userId = user.id;
  res.json({ message: "Login successful" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ message: "Logged out" }));
});

// ===== Competitions (public) =====
app.get("/api/competitions", (req, res) => {
  // Return safe public details
  const list = competitions.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    image: c.image,
    maxTickets: c.maxTickets,
    soldCount: c.soldTickets.length,
    hasEndWinner: !!c.endWinner,
  }));
  res.json(list);
});

// ===== Enter competition (user) =====
app.post("/api/enter/:compId", requireLogin, (req, res) => {
  const compId = parseInt(req.params.compId, 10);
  const comp = competitions.find(c => c.id === compId);
  if (!comp) return res.status(404).json({ error: "Competition not found" });

  if (comp.soldTickets.length >= comp.maxTickets) {
    return res.status(400).json({ error: "All tickets sold out" });
  }

  // For uniqueness, build a Set of taken numbers
  const taken = new Set(comp.soldTickets);
  const ticketNum = pickUniqueRandomTicket(comp.maxTickets, taken);

  comp.soldTickets.push(ticketNum);

  const isInstant = comp.instantWins.includes(ticketNum);
  const result = isInstant ? "Carp (Instant Win)" : "Bream";

  const ticket = {
    id: tickets.length + 1,
    userId: req.session.userId,
    compId,
    number: ticketNum,
    result,
  };
  tickets.push(ticket);

  res.json({ message: "Ticket entered", ticket });
});

// ===== User dashboard =====
app.get("/api/my-tickets", requireLogin, (req, res) => {
  const userTickets = tickets
    .filter(t => t.userId === req.session.userId)
    .map(t => {
      const comp = competitions.find(c => c.id === t.compId);
      return {
        number: t.number,
        result: t.result,
        compName: comp ? comp.name : "Unknown",
      };
    });
  res.json(userTickets);
});

// ===== Admin: create competition with instant wins =====
// Use x-admin-key header (or ?key=...) matching process.env.ADMIN_KEY
app.post("/api/admin/competitions", requireAdmin, (req, res) => {
  const { name, description, image, maxTickets } = req.body || {};
  if (!name || !description || !image) {
    return res.status(400).json({ error: "name, description, image are required" });
  }

  const totalTickets = parseInt(maxTickets, 10) > 0 ? parseInt(maxTickets, 10) : 200000;

  // Default: EXACTLY 100 instant wins
  const INSTANT_WIN_COUNT = Math.min(100, totalTickets);

  // Pre-generate unique instant-win ticket numbers
  const instant = new Set();
  while (instant.size < INSTANT_WIN_COUNT) {
    instant.add(Math.floor(Math.random() * totalTickets) + 1);
  }

  const comp = {
    id: competitions.length + 1,
    name,
    description,
    image,
    maxTickets: totalTickets,
    soldTickets: [],             // ticket numbers sold
    instantWins: Array.from(instant).sort((a, b) => a - b),
    endWinner: null,             // populated after end-draw
  };

  competitions.push(comp);
  res.json({ message: "Competition created", compId: comp.id });
});

// ===== Admin: end-of-draw winner =====
app.post("/api/admin/end-draw/:compId", requireAdmin, (req, res) => {
  const compId = parseInt(req.params.compId, 10);
  const comp = competitions.find(c => c.id === compId);
  if (!comp) return res.status(404).json({ error: "Competition not found" });

  if (comp.soldTickets.length === 0) {
    return res.status(400).json({ error: "No tickets sold" });
  }

  // Pick a random sold ticket index
  const idx = Math.floor(Math.random() * comp.soldTickets.length);
  const winningTicketNumber = comp.soldTickets[idx];

  const winningTicket = tickets.find(
    t => t.compId === compId && t.number === winningTicketNumber
  );

  comp.endWinner = winningTicket || { number: winningTicketNumber, note: "Ticket not found in global list (should not happen)" };

  res.json({
    message: "End draw completed",
    winner: comp.endWinner,
    compId: comp.id,
  });
});

// ===== Serve admin panel file (optional UI) =====
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ===== Start =====
app.listen(PORT, () => {
  console.log(`🎣 Tackle Tarts Giveaway running on port ${PORT}`);
});
