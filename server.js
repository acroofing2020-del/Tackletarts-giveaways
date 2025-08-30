const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: "tackletarts-secret",
    resave: false,
    saveUninitialized: false,
  })
);

// In-memory storage
let users = [];
let competitions = [];
let tickets = []; // { userEmail, compId, number, result }

// --- AUTH ROUTES ---

app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (users.find(u => u.email === email)) {
    return res.status(400).json({ message: "User exists" });
  }
  const hashed = await bcrypt.hash(password, 10);
  users.push({ email, password: hashed });
  res.json({ message: "Signup successful" });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ message: "Invalid email" });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ message: "Invalid password" });
  req.session.user = { email };
  res.json({ message: "Login successful" });
});

// --- COMPETITIONS ---

// Admin create competition
app.post("/api/admin/competitions", (req, res) => {
  const { name, description, image, maxTickets } = req.body;
  const id = competitions.length + 1;

  // Pick 100 instant win numbers
  let instantWins = new Set();
  while (instantWins.size < 100) {
    instantWins.add(Math.floor(Math.random() * maxTickets) + 1);
  }

  competitions.push({
    id,
    name,
    description,
    image,
    maxTickets,
    soldCount: 0,
    instantWins: Array.from(instantWins),
    tickets: [],
    ended: false,
    winner: null,
  });

  res.json({ message: "Competition created", id });
});

// Get competitions
app.get("/api/competitions", (req, res) => {
  res.json(competitions.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    image: c.image,
    maxTickets: c.maxTickets,
    soldCount: c.soldCount,
    ended: c.ended,
    winner: c.winner,
  })));
});

// Enter competition
app.post("/api/enter/:id", (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: "Login required" });
  const comp = competitions.find(c => c.id == req.params.id);
  if (!comp || comp.ended) return res.status(400).json({ message: "Invalid competition" });
  if (comp.soldCount >= comp.maxTickets) return res.status(400).json({ message: "Sold out" });

  const ticketNumber = comp.soldCount + 1;
  comp.soldCount++;

  const result = comp.instantWins.includes(ticketNumber) ? "carp" : "bream";
  comp.tickets.push({ email: req.session.user.email, number: ticketNumber, result });

  tickets.push({
    userEmail: req.session.user.email,
    compId: comp.id,
    number: ticketNumber,
    result,
  });

  res.json({ number: ticketNumber, result });
});

// End competition (admin)
app.post("/api/admin/end/:id", (req, res) => {
  const comp = competitions.find(c => c.id == req.params.id);
  if (!comp || comp.ended) return res.status(400).json({ message: "Invalid comp" });

  const randomTicket = comp.tickets[Math.floor(Math.random() * comp.tickets.length)];
  comp.ended = true;
  comp.winner = randomTicket;

  res.json({ message: "Competition ended", winner: randomTicket });
});

// --- USER DASHBOARD ---

app.get("/api/mytickets", (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: "Login required" });
  const myTickets = tickets
    .filter(t => t.userEmail === req.session.user.email)
    .map(t => {
      const comp = competitions.find(c => c.id === t.compId);
      return {
        competitionName: comp?.name || "Unknown",
        image: comp?.image || "",
        number: t.number,
        result: t.result,
      };
    });
  res.json(myTickets);
});

// --- START SERVER ---
app.listen(PORT, () => console.log(`Tackle Tarts running on port ${PORT}`));
