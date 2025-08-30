Perfect 👍 we’ll do it step by step so it’s easy. You’ll end up with a GitHub repo that Render can deploy.


---

📝 Step 1 — Create Your Repo

1. Go to github.com → sign in.


2. Click the + (top right) → New repository.


3. Name it: tackle-tarts-giveaways


4. Leave it Public → click Create repository.



Now you should see an “Add file” button.


---

📝 Step 2 — Add the Main Files

We’ll start with the two most important files:


---

📄 File 1: package.json

On GitHub → “Add file” → “Create new file”.

File name: package.json

Paste this content:


{
  "name": "tackle-tarts-giveaways",
  "version": "1.0.0",
  "description": "Tackle Tarts Giveaways Raffle App",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "sqlite3": "^5.1.7",
    "helmet": "^7.1.0",
    "express-basic-auth": "^1.2.1",
    "express-rate-limit": "^7.1.5"
  }
}

Scroll down → click Commit new file ✅


---

📄 File 2: server.js

Click Add file → Create new file again.

File name: server.js

Paste this:


const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const basicAuth = require("express-basic-auth");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// Env variables
const PORT = process.env.PORT || 8080;
const WIN_PROB = parseFloat(process.env.WIN_PROB || "0.05");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "change-me";

// Setup app
const app = express();
app.use(helmet());
app.use(express.json());
app.use(express.static("public"));

// Rate limiter (100 requests / 15 minutes per IP)
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Database setup
const db = new sqlite3.Database("data.db");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    result TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Serve main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API: draw tickets
app.post("/api/draw", (req, res) => {
  let draws = parseInt(req.query.count || "1");
  if (draws > 10) draws = 10;

  const results = [];
  for (let i = 0; i < draws; i++) {
    const isWin = Math.random() < WIN_PROB;
    const ticket = isWin ? "carp" : "bream";
    results.push(ticket);

    db.run("INSERT INTO tickets (result) VALUES (?)", [ticket]);
  }

  res.json({ results });
});

// Admin area
app.use(
  "/admin",
  basicAuth({
    users: { [ADMIN_USER]: ADMIN_PASS },
    challenge: true
  }),
  express.static("admin")
);

// API: get winners
app.get("/api/winners", (req, res) => {
  db.all(
    "SELECT * FROM tickets WHERE result='carp' ORDER BY created_at DESC",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Start server
app.listen(PORT, () => {
  console.log(`🎣 Tackle Tarts Giveaway running on port ${PORT}`);
});

Scroll down → Commit new file ✅


---

👉 At this point, you’ve got the backend ready. Next, we’ll add the frontend files (/public/index.html, /public/style.css, and /admin/index.html).

Do you want me to paste the raffle page (index.html) next?

