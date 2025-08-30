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
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false,
  })
);

// ===== In-memory storage (replace with database later) =====
let users = []; // { id, email, passwordHash }
let competitions = []; // { id, name, description, image, maxTickets, soldCount }
let tickets = []; // { userId, competitionId, number, result }

// ===== Helper =====
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  next();
}

// ===== Auth Routes =====
app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (users.find((u) => u.email === email)) {
    return res.status(400).json({ error: "Email already registered" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = { id: users.length + 1, email, passwordHash };
  users.push(newUser);
  req.session.userId = newUser.id;
  res.json({ success: true });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = users.find((u) => u.email === email);
  if (!user) return res.status(400).json({ error: "Invalid login" });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(400).json({ error: "Invalid login" });

  req.session.userId = user.id;
  res.json({ success: true });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ===== Competitions =====
app.get("/api/competitions", (req, res) => {
  res.json(competitions);
});

app.post("/api/enter/:id", requireLogin, (req, res) => {
  const comp = competitions.find((c) => c.id == req.params.id);
  if (!comp) return res.status(404).json({ error: "Competition not found" });
  if (comp.soldCount >= comp.maxTickets) {
    return res.status(400).json({ error: "All tickets sold" });
  }

  // Assign ticket number
  const ticketNum = comp.soldCount + 1;
  comp.soldCount++;

  // Random instant win 5%
  const isInstantWin = Math.random() < 0.05;
  const result = isInstantWin ? "carp" : "bream";

  const newTicket = {
    userId: req.session.userId,
    competitionId: comp.id,
    number: ticketNum,
    result,
  };
  tickets.push(newTicket);

  res.json({ number: ticketNum, result });
});

// ===== Dashboard =====
app.get("/api/dashboard", requireLogin, (req, res) => {
  const user = users.find((u) => u.id === req.session.userId);
  const userTickets = tickets
    .filter((t) => t.userId === user.id)
    .map((t) => {
      const comp = competitions.find((c) => c.id === t.competitionId);
      return {
        competition: comp ? comp.name : "Unknown",
        number: t.number,
        result: t.result,
      };
    });

  res.json({ email: user.email, tickets: userTickets });
});

// ===== Admin (simple) =====
app.post("/api/admin/create", (req, res) => {
  const { name, description, image, maxTickets } = req.body;
  const newComp = {
    id: competitions.length + 1,
    name,
    description,
    image,
    maxTickets,
    soldCount: 0,
  };
  competitions.push(newComp);
  res.json({ success: true, comp: newComp });
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`Tackle Tarts Giveaway running on port ${PORT}`);
});
