const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const path = require("path");
const basicAuth = require("express-basic-auth");

const app = express();
const PORT = process.env.PORT || 10000;

// ===== Middleware =====
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  secret: process.env.SESSION_SECRET || "supersecret",
  resave: false,
  saveUninitialized: false
}));

// ===== In-Memory Storage =====
let users = []; // { id, email, passwordHash }
let tickets = []; // { id, userId, number, result, compId }
let competitions = []; // { id, name, description, image, maxTickets, entries: [] }
let nextTicketNumber = 1;

// ===== Auth Middleware =====
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  next();
}

// ===== User Routes =====
app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing fields" });

  const existing = users.find(u => u.email === email);
  if (existing) return res.status(400).json({ error: "User already exists" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: users.length + 1, email, passwordHash };
  users.push(user);
  res.json({ success: true });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(400).json({ error: "Invalid credentials" });

  req.session.userId = user.id;
  res.json({ success: true });
});

// ===== Competition Routes =====
app.get("/api/competitions", (req, res) => {
  res.json(competitions);
});

app.post("/api/competitions", (req, res) => {
  const { name, description, image, maxTickets } = req.body;
  if (!name || !description || !image) {
    return res.status(400).json({ error: "Missing fields" });
  }
  const comp = {
    id: competitions.length + 1,
    name,
    description,
    image,
    maxTickets: maxTickets || 200000,
    entries: []
  };
  competitions.push(comp);
  res.json({ success: true, competition: comp });
});

app.delete("/api/competitions/:id", (req, res) => {
  const id = parseInt(req.params.id);
  competitions = competitions.filter(c => c.id !== id);
  res.json({ success: true });
});

// ===== Ticket Entry =====
app.post("/api/enter/:compId", requireLogin, (req, res) => {
  const compId = parseInt(req.params.compId);
  const comp = competitions.find(c => c.id === compId);
  if (!comp) return res.status(404).json({ error: "Competition not found" });

  if (comp.entries.length >= comp.maxTickets) {
    return res.status(400).json({ error: "No tickets left for this competition" });
  }

  const ticketNumber = nextTicketNumber++;
  const result = Math.random() < 0.05 ? "Carp" : "Bream"; // 5% chance to win
  const ticket = {
    id: tickets.length + 1,
    userId: req.session.userId,
    number: ticketNumber,
    result,
    compId
  };

  tickets.push(ticket);
  comp.entries.push(ticket);

  res.json({ success: true, ticket });
});

// ===== Admin Routes =====
app.use("/admin", basicAuth({
  users: { [process.env.ADMIN_USER || "admin"]: process.env.ADMIN_PASS || "password" },
  challenge: true
}));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`🎣 Tackle Tarts Giveaway running on port ${PORT}`);
});
