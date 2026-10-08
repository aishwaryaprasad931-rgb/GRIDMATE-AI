import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "data", "db.json");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "gridmate-demo-secret";

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5176"
}));
app.use(express.json());

function loadDb() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      users: [
        {
          id: "u1",
          memberId: "HOUSE001",
          name: "House 001",
          passwordHash: bcrypt.hashSync("member123", 10),
          role: "member",
          houseId: "H001",
          wallet: 500
        },
        {
          id: "u2",
          memberId: "HOUSE002",
          name: "House 002",
          passwordHash: bcrypt.hashSync("member123", 10),
          role: "member",
          houseId: "H002",
          wallet: 500
        },
        {
          id: "admin1",
          memberId: "ADMIN001",
          name: "GRIDMATE Admin",
          passwordHash: bcrypt.hashSync("admin123", 10),
          role: "admin",
          houseId: null,
          wallet: 0
        }
      ],
      houses: [
        { id: "H001", name: "House 001", solarGeneration: 12.6, consumption: 8.4, battery: 86 },
        { id: "H002", name: "House 002", solarGeneration: 4.2, consumption: 7.1, battery: 61 },
        { id: "H003", name: "House 003", solarGeneration: 10.8, consumption: 5.2, battery: 79 },
        { id: "H004", name: "House 004", solarGeneration: 2.5, consumption: 6.8, battery: 42 }
      ],
      requests: [],
      transactions: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

function getHouse(db, houseId) {
  return db.houses.find(h => h.id === houseId);
}

function getUser(db, id) {
  return db.users.find(u => u.id === id);
}

function surplus(house) {
  return Math.max(0, Number((house.solarGeneration - house.consumption).toFixed(2)));
}

function demandGap(house) {
  return Math.max(0, Number((house.consumption - house.solarGeneration).toFixed(2)));
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "GRIDMATE AI backend" });
});

// Login for both members and admins
app.post("/api/auth/login", async (req, res) => {
  const { memberId, password } = req.body;
  if (!memberId || !password) {
    return res.status(400).json({ message: "Member ID and password are required" });
  }

  const db = loadDb();
  const user = db.users.find(u => u.memberId === memberId);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: user.id, memberId: user.memberId, role: user.role, houseId: user.houseId },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({
    token,
    user: {
      id: user.id,
      memberId: user.memberId,
      name: user.name,
      role: user.role,
      houseId: user.houseId,
      wallet: user.wallet
    }
  });
});

app.get("/api/me", auth, (req, res) => {
  const db = loadDb();
  const user = getUser(db, req.user.id);
  if (!user) return res.status(404).json({ message: "User not found" });

  res.json({
    id: user.id,
    memberId: user.memberId,
    name: user.name,
    role: user.role,
    houseId: user.houseId,
    wallet: user.wallet
  });
});

// Member dashboard: only the logged-in member's house data
app.get("/api/member/dashboard", auth, (req, res) => {
  if (req.user.role !== "member") {
    return res.status(403).json({ message: "Member access required" });
  }

  const db = loadDb();
  const house = getHouse(db, req.user.houseId);
  if (!house) return res.status(404).json({ message: "House not found" });

  const availableCommunityEnergy = Number(
    db.houses.reduce((sum, h) => sum + surplus(h), 0).toFixed(2)
  );

  const pricePerKwh = 4.20;

  res.json({
    house,
    surplus: surplus(house),
    demandGap: demandGap(house),
    availableCommunityEnergy,
    pricePerKwh,
    potentialSavingPerKwh: 2.60,
    wallet: getUser(db, req.user.id).wallet,
    aiRecommendation:
      surplus(house) > 0
        ? `You have ${surplus(house)} kWh surplus. Offer it to the community or store it.`
        : demandGap(house) > 0
          ? `You need ${demandGap(house)} kWh. Request community energy before using grid fallback.`
          : "Your energy balance is currently stable."
  });
});

// Member can request energy
app.post("/api/energy/requests", auth, (req, res) => {
  if (req.user.role !== "member") {
    return res.status(403).json({ message: "Member access required" });
  }

  const amount = Number(req.body.amount);
  if (!amount || amount <= 0 || amount > 100) {
    return res.status(400).json({ message: "Enter a valid energy amount" });
  }

  const db = loadDb();
  const house = getHouse(db, req.user.houseId);

  const communitySurplus = Number(
    db.houses
      .filter(h => h.id !== req.user.houseId)
      .reduce((sum, h) => sum + surplus(h), 0)
      .toFixed(2)
  );

  const matched = Math.min(amount, communitySurplus);
  const gridFallback = Number((amount - matched).toFixed(2));

  const request = {
    id: `REQ-${Date.now()}`,
    memberId: req.user.memberId,
    houseId: house.id,
    requestedKwh: amount,
    matchedKwh: matched,
    gridFallbackKwh: gridFallback,
    status: matched > 0 ? "matched" : "grid-fallback",
    createdAt: new Date().toISOString()
  };

  db.requests.push(request);
  saveDb(db);

  res.json({
    message: matched > 0
      ? "Community energy matched successfully"
      : "No community surplus available; grid fallback required",
    request
  });
});

// Simulated purchase/payment
app.post("/api/energy/purchase", auth, (req, res) => {
  if (req.user.role !== "member") {
    return res.status(403).json({ message: "Member access required" });
  }

  const amountKwh = Number(req.body.amountKwh);
  if (!amountKwh || amountKwh <= 0) {
    return res.status(400).json({ message: "Enter a valid kWh amount" });
  }

  const db = loadDb();
  const user = getUser(db, req.user.id);
  const pricePerKwh = 4.20;
  const total = Number((amountKwh * pricePerKwh).toFixed(2));

  if (user.wallet < total) {
    return res.status(400).json({ message: "Insufficient demo wallet balance" });
  }

  user.wallet = Number((user.wallet - total).toFixed(2));

  const transaction = {
    id: `TXN-${Date.now()}`,
    memberId: user.memberId,
    type: "energy_purchase",
    amountKwh,
    pricePerKwh,
    total,
    status: "completed",
    createdAt: new Date().toISOString()
  };

  db.transactions.push(transaction);
  saveDb(db);

  res.json({
    message: "Demo payment completed",
    transaction,
    wallet: user.wallet
  });
});

app.get("/api/member/transactions", auth, (req, res) => {
  if (req.user.role !== "member") {
    return res.status(403).json({ message: "Member access required" });
  }

  const db = loadDb();
  const transactions = db.transactions.filter(t => t.memberId === req.user.memberId);
  res.json(transactions.reverse());
});

// Admin: all house-level confidential information
app.get("/api/admin/dashboard", auth, adminOnly, (req, res) => {
  const db = loadDb();

  const totalGeneration = Number(
    db.houses.reduce((sum, h) => sum + h.solarGeneration, 0).toFixed(2)
  );
  const totalConsumption = Number(
    db.houses.reduce((sum, h) => sum + h.consumption, 0).toFixed(2)
  );
  const totalSurplus = Number(
    db.houses.reduce((sum, h) => sum + surplus(h), 0).toFixed(2)
  );
  const totalDemandGap = Number(
    db.houses.reduce((sum, h) => sum + demandGap(h), 0).toFixed(2)
  );
  const revenue = Number(
    db.transactions.reduce((sum, t) => sum + t.total, 0).toFixed(2)
  );

  res.json({
    summary: {
      totalHouses: db.houses.length,
      totalGeneration,
      totalConsumption,
      totalSurplus,
      totalDemandGap,
      revenue,
      activeRequests: db.requests.filter(r => r.status === "matched").length
    },
    houses: db.houses.map(h => ({
      ...h,
      surplus: surplus(h),
      demandGap: demandGap(h)
    })),
    requests: db.requests.slice(-20).reverse(),
    transactions: db.transactions.slice(-20).reverse()
  });
});

// Admin can update simulated house readings
app.patch("/api/admin/houses/:houseId", auth, adminOnly, (req, res) => {
  const db = loadDb();
  const house = getHouse(db, req.params.houseId);

  if (!house) return res.status(404).json({ message: "House not found" });

  const allowed = ["solarGeneration", "consumption", "battery"];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const value = Number(req.body[key]);
      if (!Number.isFinite(value) || value < 0) {
        return res.status(400).json({ message: `${key} must be a non-negative number` });
      }
      house[key] = value;
    }
  }

  saveDb(db);
  res.json({
    message: "House energy data updated",
    house: { ...house, surplus: surplus(house), demandGap: demandGap(house) }
  });
});

app.use((req, res) => {
  res.status(404).json({ message: "API route not found" });
});

app.listen(PORT, () => {
  console.log(`GRIDMATE AI backend running at http://localhost:${PORT}`);
});