const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs"); // switched from bcrypt to bcryptjs
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// ===== Middleware =====
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

// ===== In-memory storage (reset on server restart) =====
let users = []; // {id, email, passwordHash}
let competitions = []; // {id, name, description, image, maxTickets}
let tickets = []; // {id, userId, compId, number, result}

// ===== Helpers =====
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  next();
}

// ===== Routes =====
app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (users.find(u => u.email === email)) {
    return res.status(400).json({ error: "Email already exists" });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = { id: users.length + 1, email, passwordHash: hash };
  users.push(user);
  req.session.userId = user.id;
  res.json({ message: "User created", user: { id: user.id, email: user.email } });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(400).json({ error: "Invalid credentials" });

  req.session.userId = user.id;
  res.json({ message: "Login successful" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Logged out" });
  });
});

// ===== Competitions =====
app.get("/api/competitions", (req, res) => {
  res.json(competitions);
});

app.post("/api/enter/:compId", requireLogin, (req, res) => {
  const compId = parseInt(req.params.compId);
  const comp = competitions.find(c => c.id === compId);
  if (!comp) return res.status(404).json({ error: "Competition not found" });

  const userEntries = tickets.filter(t => t.compId === compId);
  if (userEntries.length >= comp.maxTickets) {
    return res.status(400).json({ error: "All tickets sold out" });
  }

  const ticketNum = userEntries.length + 1;
  const result = Math.random() < 0.05 ? "Carp" : "Bream";

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

// ===== Dashboard (User Tickets) =====
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

// ===== Admin (basic, no password yet) =====
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.post("/api/admin/competitions", (req, res) => {
  const { name, description, image, maxTickets } = req.body;
  const comp = {
    id: competitions.length + 1,
    name,
    description,
    image,
    maxTickets: parseInt(maxTickets) || 100,
  };
  competitions.push(comp);
  res.json({ message: "Competition created", comp });
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`Tackle Tarts Giveaway running on port ${PORT}`);
});
