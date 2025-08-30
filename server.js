
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs"); // lightweight bcrypt alternative
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  secret: process.env.SESSION_SECRET || "supersecret",
  resave: false,
  saveUninitialized: false
}));

// In-memory storage (replace with DB later)
let users = [];
let competitions = [];
let tickets = [];
let compCounter = 1;
let ticketCounter = 1;

// -------- AUTH ROUTES --------

// Signup
app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (users.find(u => u.email === email)) {
    return res.status(400).json({ error: "Email already exists" });
  }
  const hashed = await bcrypt.hash(password, 10);
  const user = { id: users.length + 1, email, password: hashed };
  users.push(user);
  req.session.user = user;
  res.json({ message: "Signup successful", user: { id: user.id, email: user.email } });
});

// Login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ error: "Invalid email" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: "Wrong password" });

  req.session.user = user;
  res.json({ message: "Login successful" });
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ message: "Logged out" }));
});

// -------- ADMIN ROUTES --------

// Create competition
app.post("/api/admin/competitions", (req, res) => {
  const { name, description, image, maxTickets } = req.body;
  const comp = {
    id: compCounter++,
    name,
    description,
    image,
    maxTickets: parseInt(maxTickets) || 200000,
    soldCount: 0,
    instantWins: [],
    hasEndWinner: false,
    endWinner: null
  };

  // Pre-generate 100 instant win ticket numbers
  const winSet = new Set();
  while (winSet.size < 100) {
    winSet.add(Math.floor(Math.random() * comp.maxTickets) + 1);
  }
  comp.instantWins = [...winSet];

  competitions.push(comp);
  res.json({ message: "Competition created", comp });
});

// End draw
app.post("/api/admin/end-draw/:id", (req, res) => {
  const comp = competitions.find(c => c.id == req.params.id);
  if (!comp) return res.status(404).json({ error: "Competition not found" });
  if (comp.hasEndWinner) return res.status(400).json({ error: "Already ended" });

  const compTickets = tickets.filter(t => t.competitionId === comp.id);
  if (compTickets.length === 0) return res.status(400).json({ error: "No tickets sold" });

  const winner = compTickets[Math.floor(Math.random() * compTickets.length)];
  comp.hasEndWinner = true;
  comp.endWinner = winner;

  res.json({ message: "End draw complete", winner });
});

// -------- USER ROUTES --------

// Get all competitions
app.get("/api/competitions", (req, res) => {
  res.json(competitions);
});

// Buy a ticket
app.post("/api/competitions/:id/buy", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });

  const comp = competitions.find(c => c.id == req.params.id);
  if (!comp) return res.status(404).json({ error: "Competition not found" });
  if (comp.soldCount >= comp.maxTickets) {
    return res.status(400).json({ error: "All tickets sold" });
  }

  const ticketNumber = ++ticketCounter;
  const result = comp.instantWins.includes(ticketNumber) ? "Carp" : "Bream";

  const ticket = {
    id: ticketCounter,
    competitionId: comp.id,
    userId: req.session.user.id,
    number: ticketNumber,
    result
  };

  tickets.push(ticket);
  comp.soldCount++;

  res.json({ message: "Ticket purchased", ticket });
});

// Get my tickets
app.get("/api/my-tickets", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });

  const userTickets = tickets
    .filter(t => t.userId === req.session.user.id)
    .map(t => ({
      number: t.number,
      result: t.result,
      competition: competitions.find(c => c.id === t.competitionId)?.name || "Unknown"
    }));

  res.json(userTickets);
});

// -------- START SERVER --------
app.listen(PORT, () => {
  console.log(`🎣 Tackle Tarts Giveaway running on port ${PORT}`);
});
