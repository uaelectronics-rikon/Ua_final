// ✅ CRITICAL: Force IPv4 DNS BEFORE loading any modules
// This prevents nodemailer from attempting IPv6 on Render
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const sendEmail = require("./email");
const emailQueue = require("./email-queue");
const PDFDocument = require("pdfkit");
const Razorpay = require("razorpay");

// Load environment variables
require('dotenv').config();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const app = express();
const PUBLIC_DIR = path.join(__dirname, "public");
const ALLOWED_CORS_ORIGINS = [
  "https://uaelectronicsindia.com",
  "https://www.uaelectronicsindia.com",
  "http://localhost:3000",
  "http://localhost:8080",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:8080"
];
const ASSET_HEADS = [
  ["/checkout.js", path.join(__dirname, "checkout.js")],
  ["/sitemap.xml", path.join(__dirname, "sitemap.xml")],
  ["/google0c2bce1fab4a9d99.html", path.join(__dirname, "google0c2bce1fab4a9d99.html")],
];

app.disable("x-powered-by");
app.set("trust proxy", 1);

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || ALLOWED_CORS_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }

    if (/^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false
}));

app.options(/.*/, (req, res) => {
  res.sendStatus(204);
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." }
});

app.use(generalLimiter);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()" );
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use("/Image", express.static(path.join(__dirname, "Image")));

ASSET_HEADS.forEach(([route, filePath]) => {
  if (fs.existsSync(filePath)) {
    app.get(route, (req, res) => {
      res.sendFile(filePath);
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* ===============================
   🔐 ADMIN AUTH (server-side)
   =============================== */
// Credentials live in environment variables, never in code. On Render, set:
//   ADMIN_EMAIL=admin@uaelectronics.in
//   ADMIN_PASSWORD_HASH=<generated below>
// Generate the hash once locally with:
//   node -e "const c=require('crypto');const salt=c.randomBytes(16).toString('hex');const hash=c.scryptSync(process.argv[1],salt,64).toString('hex');console.log(salt+':'+hash)" "yourNewAdminPassword"
// then paste the printed "salt:hash" string as ADMIN_PASSWORD_HASH. The plaintext
// password is never stored anywhere, on the server or in git.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ? String(process.env.ADMIN_EMAIL).trim() : "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ? String(process.env.ADMIN_PASSWORD_HASH).trim() : "";

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword || typeof storedPassword !== "string") {
    return false;
  }

  if (storedPassword.includes(":")) {
    const [salt, storedHash] = storedPassword.split(":");
    if (!salt || !storedHash) return false;

    const candidateHash = crypto.scryptSync(String(password), salt, 64).toString("hex");
    const a = Buffer.from(candidateHash, "hex");
    const b = Buffer.from(storedHash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  const legacyEncoded = Buffer.from(String(password)).toString("base64");
  return storedPassword === legacyEncoded;
}

function hashUserPassword(password) {
  return hashPassword(String(password));
}

function verifyUserPassword(password, storedPassword) {
  if (!storedPassword || typeof storedPassword !== "string") {
    return false;
  }

  if (storedPassword.includes(":")) {
    return verifyPassword(password, storedPassword);
  }

  const legacyEncoded = Buffer.from(String(password)).toString("base64");
  return storedPassword === legacyEncoded;
}

function verifyAdminPassword(password) {
  if (!ADMIN_PASSWORD_HASH || !ADMIN_PASSWORD_HASH.includes(":")) {
    console.warn("⚠️ ADMIN_PASSWORD_HASH is not set — admin login is disabled until it's configured.");
    return false;
  }

  return verifyPassword(password, ADMIN_PASSWORD_HASH);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeOrderId(value) {
  return String(value || "").trim();
}

function getClientIdentifier(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const rawIp = Array.isArray(forwarded) ? forwarded[0] : forwarded || req.ip || "unknown";
  return String(rawIp).split(",")[0].trim() || "unknown";
}

const requestRateLimits = new Map();
function enforceRateLimit(key, windowMs, maxRequests, message) {
  const now = Date.now();
  const bucket = requestRateLimits.get(key) || [];
  const recent = bucket.filter(timestamp => now - timestamp < windowMs);

  if (recent.length >= maxRequests) {
    requestRateLimits.set(key, recent);
    return false;
  }

  recent.push(now);
  requestRateLimits.set(key, recent);
  return true;
}

const adminSessions = new Map();
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_MAX_ATTEMPTS = 5;
const adminLoginAttempts = new Map();

function checkAdminLoginRateLimit(email) {
  const key = String(email || "").trim().toLowerCase();
  const now = Date.now();
  const attempts = adminLoginAttempts.get(key) || [];
  const recent = attempts.filter(ts => now - ts < ADMIN_LOGIN_WINDOW_MS);

  if (recent.length >= ADMIN_LOGIN_MAX_ATTEMPTS) {
    adminLoginAttempts.set(key, recent);
    return false;
  }

  recent.push(now);
  adminLoginAttempts.set(key, recent);
  return true;
}

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const expiry = token && adminSessions.get(token);

  if (!expiry || expiry < Date.now()) {
    if (token) adminSessions.delete(token);
    return res.status(401).json({ error: "Admin session expired or invalid. Please log in again." });
  }

  adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
  next();
}

app.post("/api/admin-login", (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) {
      return res.status(503).json({ error: "Admin authentication is not configured on this server." });
    }

    const clientKey = `${getClientIdentifier(req)}:${email}`;
    if (!enforceRateLimit(clientKey, ADMIN_LOGIN_WINDOW_MS, ADMIN_LOGIN_MAX_ATTEMPTS, "Too many failed admin login attempts.")) {
      return res.status(429).json({ error: "Too many failed admin login attempts. Please try again later." });
    }

    const emailOk = email === ADMIN_EMAIL.toLowerCase();
    const passOk = verifyAdminPassword(password);

    if (!emailOk || !passOk) {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
    adminLoginAttempts.delete(email);
    requestRateLimits.delete(clientKey);

    res.json({ success: true, token, email: ADMIN_EMAIL });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ error: "Admin login failed" });
  }
});

app.post("/api/admin-logout", requireAdmin, (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (token) {
    adminSessions.delete(token);
  }
  res.json({ success: true });
});

const DATA_FILE = path.join(__dirname, "data", "orders.json");
const PRODUCTS_FILE = path.join(__dirname, "data", "products.json");
const USERS_FILE = path.join(__dirname, "data", "users.json");
const ORDERS_PDF_DIR = path.join(__dirname, "Orders");

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  } catch (err) {
    return [];
  }
}

function backupSensitiveFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const backupPath = `${filePath}.bak-${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
  } catch (err) {
    console.warn(`⚠️ Failed to back up ${filePath}:`, err.message);
  }
}

function writeUsers(users) {
  backupSensitiveFile(USERS_FILE);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function readOrders() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch (err) {
    return [];
  }
}

function writeOrders(orders) {
  backupSensitiveFile(DATA_FILE);
  fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));
}

// Ensure directories exist
if (!fs.existsSync(DATA_FILE.split("/").slice(0, -1).join("/"))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}
if (!fs.existsSync(ORDERS_PDF_DIR)) {
  fs.mkdirSync(ORDERS_PDF_DIR, { recursive: true });
}

app.get("/api/receipt/:orderId", (req, res) => {
  try {
    const { orderId } = req.params;
    const requestedEmail = String(req.query.email || "").trim().toLowerCase();
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    let orders = [];
    try {
      orders = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    } catch (err) {
      orders = [];
    }

    const order = orders.find(item => String(item.orderId) === String(orderId));
    if (!order) {
      return res.status(404).json({ error: "Receipt not found" });
    }

    const isCustomerMatch = requestedEmail && String(order.customer?.email || "").trim().toLowerCase() === requestedEmail;
    const isAdmin = bearerToken && adminSessions.get(bearerToken) && adminSessions.get(bearerToken) > Date.now();

    if (!isCustomerMatch && !isAdmin) {
      return res.status(403).json({ error: "Unauthorized access to receipt" });
    }

    const fileName = `${orderId}-receipt.pdf`;
    const filePath = path.join(ORDERS_PDF_DIR, fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Receipt file not found" });
    }

    res.download(filePath, fileName, err => {
      if (err) {
        console.error("Receipt download error:", err);
      }
    });
  } catch (error) {
    console.error("Receipt endpoint error:", error);
    res.status(500).json({ error: "Failed to fetch receipt" });
  }
});

/* ===============================
   � GET PRODUCTS
   =============================== */
app.get("/products", (req, res) => {
  try {
    const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf-8"));
    res.json(products);
  } catch (err) {
    console.error("Error reading products:", err);
    res.status(500).json({ error: "Failed to load products" });
  }
});

/* ===============================
   📦 GET SINGLE PRODUCT
   =============================== */
app.get("/product/:id", (req, res) => {
  try {
    const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf-8"));
    const product = products.find(p => p.id == req.params.id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json(product);
  } catch (err) {
    console.error("Error reading product:", err);
    res.status(500).json({ error: "Failed to load product" });
  }
});

/* ===============================
   🛠 ADMIN: UPDATE PRODUCT (price, MRP, offer badge, stock)
   =============================== */
const EDITABLE_PRODUCT_FIELDS = ["price", "mrp", "badge", "inStock", "name", "spec", "image"];
const VALID_BADGES = ["", "new", "sale", "hot", "bestseller"];

app.put("/api/admin/products/:id", requireAdmin, (req, res) => {
  try {
    const id = req.params.id;
    const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf-8"));
    const product = products.find(p => String(p.id) === String(id));
    if (!product) return res.status(404).json({ error: "Product not found" });

    if (req.body.price !== undefined) {
      const price = Number(req.body.price);
      if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: "Price must be a positive number" });
      product.price = price;
    }
    if (req.body.mrp !== undefined) {
      const mrp = Number(req.body.mrp);
      if (!Number.isFinite(mrp) || mrp < 0) return res.status(400).json({ error: "MRP must be a valid number" });
      product.mrp = mrp;
    }
    if (req.body.badge !== undefined) {
      if (!VALID_BADGES.includes(req.body.badge)) return res.status(400).json({ error: "Invalid badge value" });
      product.badge = req.body.badge;
    }
    if (req.body.inStock !== undefined) {
      product.inStock = !!req.body.inStock;
    }
    if (req.body.name !== undefined && String(req.body.name).trim()) {
      product.name = String(req.body.name).trim();
    }
    if (req.body.spec !== undefined) {
      product.spec = String(req.body.spec);
    }
    if (req.body.image !== undefined) {
      product.image = String(req.body.image).trim();
    }

    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
    res.json({ success: true, product });
  } catch (err) {
    console.error("Update product error:", err);
    res.status(500).json({ error: "Failed to update product" });
  }
});

/* ===============================
   🛠 ADMIN: ADD NEW PRODUCT
   =============================== */
app.post("/api/admin/products", requireAdmin, (req, res) => {
  try {
    const { name, brand, category, icon, image, price, mrp, spec, badge } = req.body;
    if (!name || !category || !price) {
      return res.status(400).json({ error: "Name, category, and price are required" });
    }
    if (badge !== undefined && !VALID_BADGES.includes(badge)) {
      return res.status(400).json({ error: "Invalid badge value" });
    }

    const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf-8"));
    const newProduct = {
      id: Date.now(),
      name: String(name).trim(),
      brand: brand ? String(brand).trim() : "UA RIKON",
      category,
      icon: icon || "📦",
      image: image ? String(image).trim() : "",
      price: Number(price),
      mrp: mrp ? Number(mrp) : Number(price),
      spec: spec || "",
      badge: badge || "",
      rating: 4.5,
      reviews: 0,
      inStock: true
    };
    products.unshift(newProduct);
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
    res.json({ success: true, product: newProduct });
  } catch (err) {
    console.error("Add product error:", err);
    res.status(500).json({ error: "Failed to add product" });
  }
});

/* ===============================
   🛠 ADMIN: DELETE PRODUCT
   =============================== */
app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  try {
    const id = req.params.id;
    let products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf-8"));
    const before = products.length;
    products = products.filter(p => String(p.id) !== String(id));
    if (products.length === before) return res.status(404).json({ error: "Product not found" });
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error("Delete product error:", err);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

/* ===============================
   👤 USER REGISTRATION
   =============================== */
app.post("/register", (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: "All fields required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const plainPassword = String(password);
    const trimmedName = String(name).trim();

    if (!normalizedEmail || !plainPassword || !trimmedName) {
      return res.status(400).json({ error: "All fields required" });
    }

    const users = readUsers();

    if (users.find(u => String(u.email).trim().toLowerCase() === normalizedEmail)) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const newUser = {
      id: Date.now().toString(),
      email: normalizedEmail,
      password: hashUserPassword(plainPassword),
      name: trimmedName,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    writeUsers(users);

    res.json({ success: true, message: "User registered successfully", userId: newUser.id });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

/* ===============================
   🔐 USER LOGIN
   =============================== */
app.post("/login", (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const users = readUsers();
    const userIndex = users.findIndex(u => String(u.email).trim().toLowerCase() === normalizedEmail);
    const user = userIndex >= 0 ? users[userIndex] : null;

    if (!user || !verifyUserPassword(password, user.password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!String(user.password).includes(":")) {
      user.password = hashUserPassword(String(password));
      writeUsers(users);
    }

    res.json({ success: true, userId: user.id, name: user.name, email: user.email });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/razorpay-config", (req, res) => {
  res.json({ keyId: process.env.RAZORPAY_KEY_ID || "" });
});

app.post("/api/create-order", async (req, res) => {
  try {
    const { amount, currency = "INR", receipt, orderId } = req.body;
    const amountInPaise = Number(amount);

    if (!Number.isFinite(amountInPaise) || amountInPaise < 100 || amountInPaise > 100000000) {
      return res.status(400).json({ error: "Amount must be between 100 paise and 1,000,000 INR" });
    }

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(401).json({ error: "Razorpay credentials are not configured" });
    }

    if (typeof receipt !== "string" || !/^UAE[0-9A-Za-z-]+$/.test(receipt)) {
      return res.status(400).json({ error: "Invalid receipt format" });
    }

    const orderPayload = {
      amount: Math.round(amountInPaise),
      currency,
      receipt: receipt || orderId || `order-${Date.now()}`
    };

    const razorpayOrder = await razorpay.orders.create(orderPayload);

    res.json({
      order_id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      receipt: razorpayOrder.receipt
    });
  } catch (error) {
    console.error("Razorpay create order error:", error);
    const statusCode = error.statusCode === 401 ? 401 : 500;
    res.status(statusCode).json({
      error: "Failed to create Razorpay order",
      details: error.error?.description || error.message
    });
  }
});

app.post("/api/verify-payment", async (req, res) => {
  try {
    const {
      order_id,
      orderId,
      payment_id,
      paymentId,
      razorpay_signature,
      razorpaySignature,
      amount,
      currency
    } = req.body;

    const resolvedOrderId = order_id || orderId;
    const resolvedPaymentId = payment_id || paymentId;
    const resolvedSignature = razorpay_signature || razorpaySignature;

    if (!resolvedOrderId || !resolvedPaymentId || !resolvedSignature) {
      return res.status(400).json({ error: "Missing payment verification fields" });
    }

    if (!process.env.RAZORPAY_KEY_SECRET) {
      return res.status(401).json({ error: "Razorpay secret is not configured" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${resolvedOrderId}|${resolvedPaymentId}`)
      .digest("hex");

    const providedSignature = String(resolvedSignature);
    const isValid = providedSignature.length === expectedSignature.length &&
      crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(providedSignature));

    if (!isValid) {
      return res.status(400).json({ success: false, verified: false, error: "Signature mismatch" });
    }

    const orderAmount = Number(amount);
    const normalizedCurrency = String(currency || "INR").toUpperCase();
    const payment = await razorpay.payments.fetch(resolvedPaymentId).catch(() => null);

    if (!payment) {
      return res.status(404).json({ success: false, verified: false, error: "Payment record not found" });
    }

    const paymentOrderId = payment.order_id || "";
    const paymentAmount = Number(payment.amount || 0);
    const paymentCurrency = String(payment.currency || "").toUpperCase();
    const capturedStatus = payment.status || "";

    if (paymentOrderId !== resolvedOrderId) {
      return res.status(400).json({ success: false, verified: false, error: "Payment order mismatch" });
    }

    if (Number.isFinite(orderAmount) && paymentAmount !== Math.round(orderAmount * 100)) {
      return res.status(400).json({ success: false, verified: false, error: "Payment amount mismatch" });
    }

    if (normalizedCurrency !== paymentCurrency) {
      return res.status(400).json({ success: false, verified: false, error: "Payment currency mismatch" });
    }

    if (capturedStatus !== "captured") {
      return res.status(400).json({ success: false, verified: false, error: "Payment is not captured" });
    }

    res.json({ success: true, verified: true, message: "Payment signature verified" });
  } catch (error) {
    console.error("Razorpay verify signature error:", error);
    res.status(500).json({ error: "Failed to verify Razorpay payment" });
  }
});

/* ===============================
   💳 PAYMENT METHOD: CASH ON DELIVERY ONLY
   =============================== */
// Online payments are now enabled through Razorpay Standard Checkout
console.log("✅ Payment Method: Razorpay Standard Checkout + COD available");

/* ===============================
   📄 PDF GENERATION HELPER FUNCTION
   =============================== */
function generateOrderPDF(orderData) {
  return new Promise((resolve, reject) => {
    try {
      if (!orderData || !orderData.orderId) {
        return reject(new Error("Invalid order data"));
      }

      if (!fs.existsSync(ORDERS_PDF_DIR)) {
        fs.mkdirSync(ORDERS_PDF_DIR, { recursive: true });
      }

      const fileName = `${orderData.orderId}-receipt.pdf`;
      const filePath = path.join(ORDERS_PDF_DIR, fileName);
      
      console.log("📝 Generating PDF:", filePath);

      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const stream = fs.createWriteStream(filePath);
      
      let resolved = false;

      stream.on("finish", () => {
        console.log("✅ PDF saved:", filePath);
        if (!resolved) {
          resolved = true;
          resolve({ success: true, fileName, filePath: filePath, urlPath: `/Orders/${fileName}` });
        }
      });

      stream.on("error", (err) => {
        console.error("❌ Stream error:", err);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      doc.on("error", (err) => {
        console.error("❌ Document error:", err);
        stream.destroy();
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      doc.pipe(stream);

      // Header
      doc.fontSize(24).font("Helvetica-Bold").text("UA ELECTRONICS", { align: "center" });
      doc.fontSize(10).font("Helvetica").fillColor("#999").text("Official UA RIKON Dealer", { align: "center" });
      doc.moveDown(0.5);
      doc.lineTo(doc.page.margins.left, doc.y, doc.page.width - doc.page.margins.right, doc.y).stroke();
      doc.moveDown(1);

      // Order Title and ID
      doc.fontSize(14).font("Helvetica-Bold").fillColor("#000").text("ORDER RECEIPT", { align: "left" });
      doc.fontSize(12).text(`Order ID: ${orderData.orderId}`, { align: "left" });
      doc.fontSize(10).fillColor("#555").text(`Date: ${new Date(orderData.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`);
      doc.moveDown(1);

      // Customer Details
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#000").text("DELIVERY INFORMATION");
      doc.fontSize(10).font("Helvetica").fillColor("#333");
      const customer = orderData.customer || {};
      doc.text(`Name: ${customer.name || "N/A"}`);
      doc.text(`Mobile: ${customer.mobile || "N/A"}`);
      doc.text(`Email: ${customer.email || "N/A"}`);
      doc.text(`Address: ${customer.addr1 || ""}, ${customer.addr2 || ""}, ${customer.city || ""} - ${customer.pin || ""}`);
      doc.text(`State: ${customer.state || "N/A"}`);
      if (customer.notes) doc.text(`Notes: ${customer.notes}`);
      doc.moveDown(1);

      // Payment Details
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#000").text("PAYMENT INFORMATION");
      doc.fontSize(10).font("Helvetica").fillColor("#333");
      doc.text(`Payment Method: ${orderData.paymentMethod || "N/A"}`);
      doc.text(`Payment Status: ${orderData.paymentStatus || "N/A"}`);
      doc.moveDown(1);

      // Delivery Time Info
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#C9A227").text("ESTIMATED DELIVERY TIME");
      doc.fontSize(10).font("Helvetica").fillColor("#333").text("2-8 Working Days");
      doc.moveDown(1);

      // Items Table
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#000").text("ORDER ITEMS");
      doc.fontSize(9).font("Helvetica").fillColor("#333");
      
      const items = orderData.items || [];
      const tableTop = doc.y + 10;
      const itemColX = 50;
      const qtyColX = 320;
      const priceColX = 380;
      const subtotalColX = 460;

      // Table header
      doc.font("Helvetica-Bold").fillColor("#000");
      doc.text("Item", itemColX, tableTop);
      doc.text("Qty", qtyColX, tableTop);
      doc.text("Price", priceColX, tableTop);
      doc.text("Subtotal", subtotalColX, tableTop);
      
      doc.moveTo(itemColX, tableTop + 15).lineTo(550, tableTop + 15).stroke();
      doc.moveDown(1.2);

      // Items rows
      doc.font("Helvetica").fillColor("#333").fontSize(9);
      items.forEach((item) => {
        const itemText = `${item.name}`;
        doc.text(itemText.substring(0, 30), itemColX, doc.y);
        doc.text(item.qty.toString(), qtyColX, doc.y - doc.currentLineHeight());
        doc.text(`₹${item.price.toLocaleString("en-IN")}`, priceColX, doc.y - doc.currentLineHeight());
        doc.text(`₹${item.subtotal.toLocaleString("en-IN")}`, subtotalColX, doc.y - doc.currentLineHeight());
        doc.moveDown(0.8);
      });

      doc.moveTo(itemColX, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.8);

      // Totals
      doc.font("Helvetica").fontSize(10).fillColor("#333");
      doc.text(`Subtotal: ₹${(orderData.subtotal || 0).toLocaleString("en-IN")}`, { align: "right" });
      doc.text(`Delivery Charge: ₹${(orderData.shipping || 0).toLocaleString("en-IN")}`, { align: "right" });
      
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#C9A227");
      doc.text(`TOTAL: ₹${(orderData.grand || 0).toLocaleString("en-IN")}`, { align: "right" });
      
      doc.moveDown(2);

      // Footer
      doc.fontSize(9).font("Helvetica").fillColor("#999");
      doc.lineTo(doc.page.margins.left, doc.y, doc.page.width - doc.page.margins.right, doc.y).stroke();
      doc.moveDown(0.5);
      doc.text("Thank you for shopping with UA Electronics!", { align: "center" });
      doc.text("For queries, contact: support@uaelectronicsindia.com | Phone: +91-96503-55125-UA-RIKON", { align: "center" });
      doc.text("Pan India Delivery • 1 Year Warranty • 10-Day Easy Returns", { align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}


app.post("/save-order", async (req, res) => {
  try {
    const newOrder = req.body;

    if (!newOrder || !Array.isArray(newOrder.items) || newOrder.items.length === 0) {
      console.error("❌ Invalid order data - no items");
      return res.status(400).json({ error: "No items in order", success: false });
    }

    if (!newOrder.customer || !newOrder.customer.email || !newOrder.customer.name || !newOrder.customer.mobile) {
      console.error("❌ Invalid order data - no customer email");
      return res.status(400).json({ error: "Customer name, mobile and email required", success: false });
    }

    if (!/^\d{10}$/.test(String(newOrder.customer.mobile).replace(/\D/g, ""))) {
      return res.status(400).json({ error: "Valid 10-digit mobile number required", success: false });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(newOrder.customer.email).trim())) {
      return res.status(400).json({ error: "Valid email required", success: false });
    }

    if (!Number.isFinite(Number(newOrder.grand)) || Number(newOrder.grand) <= 0) {
      return res.status(400).json({ error: "Valid order amount required", success: false });
    }

    if (String(newOrder.orderId || "").length > 64) {
      return res.status(400).json({ error: "Invalid order ID length", success: false });
    }

    // ✅ Re-validate every item against the live catalog. Prices and totals sent
    // by the browser are never trusted — this recomputes them from products.json
    // so a stale cart or a tampered request can't under-charge or sell something
    // that's out of stock.
    let catalog = [];
    try {
      catalog = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf-8"));
    } catch (e) {
      catalog = [];
    }

    const outOfStock = [];
    const missing = [];
    let subtotal = 0;

    for (const item of newOrder.items) {
      const product = catalog.find(p => String(p.id) === String(item.id));
      if (!product) { missing.push(item.name || item.id); continue; }
      if (product.inStock === false) { outOfStock.push(product.name); continue; }
      const qty = Math.max(1, Math.min(99, parseInt(item.qty) || 1));
      item.qty = qty;
      item.price = product.price; // server price wins, always
      item.name = product.name;
      item.subtotal = product.price * qty;
      subtotal += item.subtotal;
    }

    if (missing.length) {
      return res.status(409).json({ error: `No longer available: ${missing.join(", ")}. Please remove from your cart.`, success: false, code: "ITEMS_MISSING" });
    }
    if (outOfStock.length) {
      return res.status(409).json({ error: `Out of stock: ${outOfStock.join(", ")}. Please remove from your cart.`, success: false, code: "OUT_OF_STOCK" });
    }

    const shipping = subtotal >= 999 ? 0 : 49;
    newOrder.subtotal = subtotal;
    newOrder.shipping = shipping;
    newOrder.grand = subtotal + shipping;
    if (newOrder.paid !== true && newOrder.paymentMethod === "online") {
      newOrder.paymentStatus = "Pending";
    }

    if (!newOrder.orderId) {
      newOrder.orderId = "UAE" + Date.now();
    }

    // Add timestamp if not present
    if (!newOrder.date) {
      newOrder.date = new Date().toISOString();
    }

    // New orders always start in the "Confirmed" tracking stage
    newOrder.status = "Confirmed";

    console.log("📝 Saving order:", newOrder.orderId);

    let orders = [];
    try {
      orders = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    } catch (e) {
      orders = [];
    }

    const duplicateOrder = orders.some(order => String(order.orderId || "") === String(newOrder.orderId));
    if (duplicateOrder) {
      return res.status(409).json({ error: "Order already exists", success: false });
    }

    orders.push(newOrder);
    writeOrders(orders);

    console.log("✅ Order saved successfully:", newOrder.orderId);

    // � Generate PDF FIRST - before sending email
    let pdfFilePath = null;
    try {
      if (newOrder.orderId) {
        const pdfResult = await generateOrderPDF(newOrder);
        pdfFilePath = pdfResult.filePath;
        console.log("✅ PDF generated successfully:", pdfFilePath);
      }
    } catch (pdfError) {
      console.error("⚠️ PDF generation error:", pdfError.message);
      // Continue with email even if PDF generation fails
    }

    // 📩 Send Email with PDF attachment
    if (newOrder.customer?.email) {
      const emailSent = await sendEmail(newOrder.customer.email, newOrder, pdfFilePath);
      if (emailSent) {
        console.log("✅ Order confirmation email sent successfully:", newOrder.orderId);
      } else {
        console.warn("⚠️ Email send failed but order was saved. Customer may not receive confirmation.");
      }
    } else {
      console.warn("⚠️ No customer email provided - skipping email notification");
    }

    res.json({ success: true, orderId: newOrder.orderId, message: "Order placed successfully", order: newOrder });
  } catch (err) {
    console.error("❌ Order save error:", err);
    res.status(500).json({ error: "Failed to save order", details: err.message, success: false });
  }
});

/* ===============================
   📦 GET ALL ORDERS
   =============================== */
app.get("/orders", requireAdmin, (req, res) => {
  try {
    const orders = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    res.json(orders);
  } catch (err) {
    console.error("Error reading orders:", err);
    res.json([]);
  }
});

/* ===============================
   🗑 DELETE ORDER
   =============================== */
app.delete("/delete-order/:id", requireAdmin, (req, res) => {
  try {
    const id = req.params.id;

    let orders = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    orders = orders.filter(o => o.orderId !== id);

    fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));

    res.json({ success: true, message: "Order deleted" });
  } catch (err) {
    console.error("Delete order error:", err);
    res.status(500).json({ error: "Failed to delete order" });
  }
});

/* ===============================
   ✏️ UPDATE STATUS
   =============================== */
app.post("/update-status", requireAdmin, (req, res) => {
  try {
    const { orderId, status } = req.body;

    if (!orderId || !status) {
      return res.status(400).json({ error: "Order ID and status required" });
    }

    let orders = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));

    orders = orders.map(o => {
      if (o.orderId === orderId) {
        o.status = status;
      }
      return o;
    });

    fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));

    res.json({ success: true, message: "Status updated" });
  } catch (err) {
    console.error("Update status error:", err);
    res.status(500).json({ error: "Failed to update status" });
  }
});

/* ===============================
   📦 TRACK ORDER
   =============================== */
app.get("/track/:id", (req, res) => {
  try {
    const id = normalizeOrderId(req.params.id).toLowerCase();
    if (!id || id.length < 3 || !/^[a-z0-9-]+$/i.test(id)) {
      return res.status(400).json({ error: "Invalid order ID" });
    }

    const orders = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    const order = orders.find(o => String(o.orderId || "").toLowerCase() === id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(order);
  } catch (err) {
    console.error("Track order error:", err);
    res.status(500).json({ error: "Failed to track order" });
  }
});

/* ===============================
   ❌ CUSTOMER: CANCEL ORDER
   =============================== */
// A customer can cancel their own order — verified by exact order ID + the
// email it was placed under — as long as it hasn't shipped yet.
const NON_CANCELLABLE_STATUSES = ["Shipped", "Out for Delivery", "Delivered", "Cancelled"];

app.post("/api/cancel-order", (req, res) => {
  try {
    const orderId = normalizeOrderId(req.body?.orderId);
    const email = normalizeEmail(req.body?.email);

    if (!orderId || !email) {
      return res.status(400).json({ error: "Order ID and email required" });
    }

    if (!/^[A-Za-z0-9-]+$/.test(orderId)) {
      return res.status(400).json({ error: "Invalid order ID format" });
    }

    let orders = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    const order = orders.find(o => String(o.orderId || "") === orderId);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const storedEmail = normalizeEmail(order.customer?.email);
    if (storedEmail !== email) {
      return res.status(403).json({ error: "This order doesn't match that email address" });
    }

    const currentStatus = order.status || "Confirmed";
    if (NON_CANCELLABLE_STATUSES.includes(currentStatus)) {
      return res.status(409).json({ error: `This order is already "${currentStatus}" and can no longer be cancelled. Please contact support.` });
    }

    const customerIdentifier = String(order.customer?.mobile || "").replace(/\D/g, "");
    if (!customerIdentifier || customerIdentifier.length < 10) {
      return res.status(403).json({ error: "Customer order details are incomplete. Please contact support." });
    }

    order.status = "Cancelled";
    order.cancelledAt = new Date().toISOString();
    writeOrders(orders);

    res.json({ success: true, message: "Order cancelled", status: order.status });
  } catch (err) {
    console.error("Cancel order error:", err);
    res.status(500).json({ error: "Failed to cancel order" });
  }
});


/* ===============================
   💳 ONLINE PAYMENTS DISABLED
   =============================== */
// Endpoint removed - Only Cash on Delivery (COD) is available
// Customers must use COD payment method for all orders

/* ===============================
   ✅ PAYMENT VERIFICATION DISABLED
   =============================== */
// Endpoint removed - Only Cash on Delivery (COD) verification
// No online payment verification needed

/* ===============================
   � GENERATE ORDER PDF
   =============================== */
app.post("/generate-pdf", (req, res) => {
  try {
    const orderData = req.body;
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const requesterEmail = normalizeEmail(req.body?.customer?.email || req.query?.email || "");

    if (!orderData || !orderData.orderId) {
      console.error("❌ Invalid order data received");
      return res.status(400).json({ error: "Invalid order data" });
    }

    const isAdmin = bearerToken && adminSessions.get(bearerToken) && adminSessions.get(bearerToken) > Date.now();
    const storedOrder = readOrders().find(item => String(item.orderId || "") === String(orderData.orderId));
    const isAuthorizedCustomer = !!storedOrder && normalizeEmail(storedOrder.customer?.email || "") === requesterEmail;

    if (!isAdmin && !isAuthorizedCustomer) {
      return res.status(403).json({ error: "Unauthorized: only the customer or admin can generate receipts" });
    }

    if (!fs.existsSync(ORDERS_PDF_DIR)) {
      console.log("📁 Creating Orders directory:", ORDERS_PDF_DIR);
      fs.mkdirSync(ORDERS_PDF_DIR, { recursive: true });
    }

    const fileName = `${orderData.orderId}-receipt.pdf`;
    const filePath = path.join(ORDERS_PDF_DIR, fileName);
    
    console.log("📝 Generating PDF:", filePath);

    // Create PDF with A4 dimensions
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const stream = fs.createWriteStream(filePath);
    
    let responsesSent = false;

    // Handle stream events FIRST
    stream.on("finish", () => {
      console.log("✅ PDF saved successfully:", filePath);
      if (!responsesSent) {
        responsesSent = true;
        res.json({ success: true, fileName, filePath: `/Orders/${fileName}` });
      }
    });

    stream.on("error", (err) => {
      console.error("❌ Stream error:", err);
      if (!responsesSent) {
        responsesSent = true;
        res.status(500).json({ error: "Failed to write PDF: " + err.message });
      }
    });

    doc.on("error", (err) => {
      console.error("❌ Document error:", err);
      stream.destroy();
      if (!responsesSent) {
        responsesSent = true;
        res.status(500).json({ error: "Failed to generate PDF: " + err.message });
      }
    });

    // Pipe document to stream
    doc.pipe(stream);

    // Color constants - Samsung Premium Blue Theme
    const PRIMARY_BLUE = "#1428A0";
    const ACCENT_BLUE = "#2189FF";
    const DARK_NAVY = "#0F172A";
    const LIGHT_BG = "#F5F7FA";
    const BORDER_COLOR = "#E5E7EB";
    const TEXT_DARK = "#111111";
    const TEXT_SECONDARY = "#333333";

    // ═══════════════════════════════════════════════════════
    // HEADER WITH PREMIUM GRADIENT EFFECT
    // ═══════════════════════════════════════════════════════
    
    // Header background rectangle (simulating gradient)
    doc.rect(0, 0, doc.page.width, 120)
      .fillAndStroke(PRIMARY_BLUE, PRIMARY_BLUE);

    // Header content
    doc.fontSize(28)
      .font("Helvetica-Bold")
      .fillColor("#FFFFFF")
      .text("UA ELECTRONICS", { align: "center", width: doc.page.width - 100 });
    
    doc.fontSize(10)
      .font("Helvetica")
      .fillColor("rgba(255,255,255,0.85)")
      .text("Official UA RIKON Premium Electronics Retailer", { align: "center", width: doc.page.width - 100 });
    
    doc.moveDown(0.5);
    
    doc.fontSize(11)
      .font("Helvetica-Bold")
      .fillColor("#FFFFFF")
      .text("ORDER RECEIPT", { align: "center", width: doc.page.width - 100 });

    // ═══════════════════════════════════════════════════════
    // ORDER METADATA
    // ═══════════════════════════════════════════════════════
    doc.moveDown(1.5);
    
    doc.fontSize(10)
      .font("Helvetica-Bold")
      .fillColor(TEXT_DARK)
      .text(`Order ID: ${orderData.orderId}`, 50);
    
    const orderDateFormatted = new Date(orderData.date).toLocaleDateString("en-IN", { 
      day: "2-digit", 
      month: "short", 
      year: "numeric" 
    });
    
    doc.fontSize(9)
      .font("Helvetica")
      .fillColor(TEXT_SECONDARY)
      .text(`Placed on: ${orderDateFormatted}`)
      .text(`Status: ${orderData.status || 'Confirmed'}`, { color: ACCENT_BLUE });
    
    doc.moveDown(1);

    // ═══════════════════════════════════════════════════════
    // SECTION: DELIVERY INFORMATION
    // ═══════════════════════════════════════════════════════
    doc.fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(PRIMARY_BLUE)
      .text("📍 DELIVERY INFORMATION", 50);
    
    doc.fontSize(9)
      .font("Helvetica")
      .fillColor(TEXT_SECONDARY);
    
    const customer = orderData.customer || {};
    const deliveryInfo = [
      [`Name:`, customer.name || 'N/A'],
      [`Mobile:`, customer.mobile || 'N/A'],
      [`Email:`, customer.email || 'N/A'],
      [`Address:`, `${customer.addr1 || ''}${customer.addr2 ? ', ' + customer.addr2 : ''}`],
      [`City:`, `${customer.city || 'N/A'} - ${customer.pin || 'N/A'}`],
      [`State:`, customer.state || 'N/A']
    ];

    deliveryInfo.forEach(([label, value]) => {
      doc.font("Helvetica-Bold").fillColor(TEXT_DARK).text(label, 50, doc.y, { width: 80, continued: true });
      doc.font("Helvetica").fillColor(TEXT_SECONDARY).text(` ${value}`);
    });

    if (customer.notes) {
      doc.font("Helvetica-Bold").fillColor(TEXT_DARK).text("Notes:", 50, doc.y, { width: 80, continued: true });
      doc.font("Helvetica").fillColor(TEXT_SECONDARY).text(` ${customer.notes}`);
    }

    doc.moveDown(1);

    // ═══════════════════════════════════════════════════════
    // SECTION: PAYMENT INFORMATION
    // ═══════════════════════════════════════════════════════
    doc.fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(PRIMARY_BLUE)
      .text("💳 PAYMENT INFORMATION", 50);
    
    doc.fontSize(9)
      .font("Helvetica")
      .fillColor(TEXT_SECONDARY);
    
    const paymentMethod = orderData.paymentMethod === 'online' ? 'Online (Razorpay)' : 'Cash on Delivery (COD)';
    doc.font("Helvetica-Bold").fillColor(TEXT_DARK).text("Method:", 50, doc.y, { width: 80, continued: true });
    doc.font("Helvetica").fillColor(TEXT_SECONDARY).text(` ${paymentMethod}`);
    
    doc.font("Helvetica-Bold").fillColor(TEXT_DARK).text("Status:", 50, doc.y, { width: 80, continued: true });
    doc.font("Helvetica").fillColor(ACCENT_BLUE).text(` ${orderData.paymentStatus || 'Pending'}`);

    doc.moveDown(1.2);

    // ═══════════════════════════════════════════════════════
    // SECTION: ORDER ITEMS TABLE
    // ═══════════════════════════════════════════════════════
    doc.fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(PRIMARY_BLUE)
      .text("📦 ORDER ITEMS", 50);
    
    doc.moveDown(0.5);

    const tableTop = doc.y + 12;
    const col1 = 50;
    const col2 = 300;
    const col3 = 380;
    const col4 = 480;
    const tableHeight = 18;
    const lineY = tableTop - 5;

    // TABLE HEADER
    doc.rect(col1 - 10, lineY - 2, 510, tableHeight)
      .fillAndStroke(PRIMARY_BLUE, PRIMARY_BLUE);

    doc.fontSize(9)
      .font("Helvetica-Bold")
      .fillColor("#FFFFFF")
      .text("Item", col1, lineY + 4)
      .text("Qty", col2, lineY + 4, { width: 60, align: "center" })
      .text("Price", col3, lineY + 4, { width: 70, align: "right" })
      .text("Subtotal", col4, lineY + 4, { width: 60, align: "right" });

    let currentY = tableTop + tableHeight + 5;
    let rowCount = 0;

    // TABLE ROWS
    const items = orderData.items || [];
    items.forEach((item) => {
      const rowBg = rowCount % 2 === 0 ? "#F8FAFC" : "#FFFFFF";
      
      // Row background
      doc.rect(col1 - 10, currentY - 4, 510, 16)
        .fillAndStroke(rowBg, BORDER_COLOR);

      doc.fontSize(8)
        .font("Helvetica")
        .fillColor(TEXT_SECONDARY);

      const itemName = item.name.substring(0, 45);
      doc.text(itemName, col1, currentY, { width: 240 });
      doc.text(item.qty.toString(), col2, currentY - doc.currentLineHeight(), { width: 60, align: "center" });
      doc.text(`₹${item.price.toLocaleString("en-IN")}`, col3, currentY - doc.currentLineHeight(), { width: 70, align: "right" });
      doc.text(`₹${item.subtotal.toLocaleString("en-IN")}`, col4, currentY - doc.currentLineHeight(), { width: 60, align: "right" });

      currentY += 16;
      rowCount++;
    });

    doc.moveDown(0.5);

    // ═══════════════════════════════════════════════════════
    // SECTION: PRICING SUMMARY
    // ═══════════════════════════════════════════════════════
    doc.moveDown(1);
    
    const summaryY = doc.y;
    const summaryX = 350;
    const labelWidth = 140;
    const valueWidth = 100;

    // Subtotal
    doc.fontSize(9)
      .font("Helvetica")
      .fillColor(TEXT_SECONDARY)
      .text("Subtotal:", summaryX, summaryY);
    
    doc.fontSize(9)
      .font("Helvetica-Bold")
      .fillColor(TEXT_DARK)
      .text(`₹${(orderData.subtotal || 0).toLocaleString('en-IN')}`, summaryX + labelWidth, summaryY, { align: "right", width: valueWidth });

    // Delivery Charge
    doc.fontSize(9)
      .font("Helvetica")
      .fillColor(TEXT_SECONDARY)
      .text("Delivery Charge:", summaryX, doc.y + 14);
    
    doc.fontSize(9)
      .font("Helvetica-Bold")
      .fillColor(TEXT_DARK)
      .text(`₹${(orderData.shipping || 0).toLocaleString('en-IN')}`, summaryX + labelWidth, doc.y - 14, { align: "right", width: valueWidth });

    doc.moveDown(1.5);

    // GRAND TOTAL - PREMIUM STYLE
    const grandTotalY = doc.y;
    doc.rect(summaryX - 10, grandTotalY - 2, valueWidth + labelWidth + 10, 28)
      .fillAndStroke(ACCENT_BLUE, ACCENT_BLUE);

    doc.fontSize(10)
      .font("Helvetica-Bold")
      .fillColor("#FFFFFF")
      .text("TOTAL AMOUNT", summaryX, grandTotalY + 2);
    
    doc.fontSize(16)
      .font("Helvetica-Bold")
      .fillColor("#FFFFFF")
      .text(`₹${(orderData.grand || 0).toLocaleString('en-IN')}`, summaryX + labelWidth, grandTotalY + 4, { align: "right", width: valueWidth });

    doc.moveDown(2.5);

    // ═══════════════════════════════════════════════════════
    // SECTION: DELIVERY TIMELINE
    // ═══════════════════════════════════════════════════════
    doc.fontSize(10)
      .font("Helvetica-Bold")
      .fillColor(PRIMARY_BLUE)
      .text("⏱️ ESTIMATED DELIVERY TIME", 50);
    
    doc.fontSize(9)
      .font("Helvetica")
      .fillColor(TEXT_SECONDARY)
      .text("2–8 Working Days")
      .text("Your order will be carefully packed and shipped within 24 hours. You'll receive a tracking update via email.");

    doc.moveDown(1.2);

    // ═══════════════════════════════════════════════════════
    // DIVIDER LINE
    // ═══════════════════════════════════════════════════════
    doc.moveTo(50, doc.y)
      .lineTo(doc.page.width - 50, doc.y)
      .stroke(BORDER_COLOR);

    doc.moveDown(1);

    // ═══════════════════════════════════════════════════════
    // BENEFITS / WHY UA ELECTRONICS
    // ═══════════════════════════════════════════════════════
    doc.fontSize(10)
      .font("Helvetica-Bold")
      .fillColor(PRIMARY_BLUE)
      .text("✨ WHY UA ELECTRONICS?", 50);
    
    doc.fontSize(8)
      .font("Helvetica")
      .fillColor(TEXT_SECONDARY);

    const benefits = [
      "✓ Pan India Delivery — Fast & reliable shipping",
      "✓ 1 Year Manufacturer Warranty — Full protection",
      "✓ 10-Day Easy Returns — Hassle-free policy",
      "✓ 24/7 Customer Support — Always here to help"
    ];

    benefits.forEach(benefit => {
      doc.text(benefit, 60, doc.y + 4, { width: 460 }).moveDown(0.5);
    });

    doc.moveDown(1);

    // ═══════════════════════════════════════════════════════
    // FOOTER - DARK NAVY PREMIUM STYLE
    // ═══════════════════════════════════════════════════════
    const footerY = doc.page.height - 80;
    
    doc.rect(0, footerY - 10, doc.page.width, 80)
      .fillAndStroke(DARK_NAVY, DARK_NAVY);

    doc.fontSize(10)
      .font("Helvetica-Bold")
      .fillColor(ACCENT_BLUE)
      .text("🔧 UA ELECTRONICS", 50, footerY, { width: doc.page.width - 100, align: "center" });
    
    doc.fontSize(8)
      .font("Helvetica")
      .fillColor("#CBD5E1")
      .text("Thank you for shopping with UA Electronics!", { align: "center", width: doc.page.width - 100 })
      .text("For support, contact:", { align: "center", width: doc.page.width - 100 });
    
    doc.fontSize(8)
      .fillColor(ACCENT_BLUE)
      .text("📧 rikon@uaelectronicsindia.com  |  🌐 uaelectronicsindia.com", { align: "center", width: doc.page.width - 100 });
    
    doc.fontSize(7)
      .fillColor("#94A3B8")
      .text("© 2026 UA Electronics. Pan India Delivery • 1 Year Warranty • 10-Day Easy Returns", { align: "center", width: doc.page.width - 100 });

    console.log("📄 PDF document stream completed, waiting for write finish...");
    doc.end();

  } catch (err) {
    console.error("❌ PDF generation exception:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDF: " + err.message });
    }
  }
});

/* ===============================   📧 TEST EMAIL ENDPOINT
   =============================== */
app.post("/test-email", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearerToken || !adminSessions.get(bearerToken) || adminSessions.get(bearerToken) <= Date.now()) {
      return res.status(401).json({ error: "Admin authorization required to send test emails" });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email address required", success: false });
    }

    console.log("\n📧 SENDING TEST EMAIL");
    console.log("   Recipient:", email);

    const testOrder = {
      orderId: 'TEST-' + Date.now(),
      date: new Date().toISOString(),
      customer: {
        name: 'Test Customer',
        email: email,
        mobile: '+91-9876543210',
        addr1: 'Test Address Line 1',
        addr2: 'Test Address Line 2',
        city: 'Test City',
        pin: '123456',
        state: 'Test State'
      },
      items: [
        {
          id: 1,
          name: 'Test Product - UA RIKON Induction Cooktop',
          qty: 1,
          price: 2499,
          subtotal: 2499
        }
      ],
      subtotal: 2499,
      shipping: 0,
      grand: 2499,
      paymentMethod: 'cod',
      paymentStatus: 'Pending',
      status: 'Confirmed'
    };

    const emailSent = await sendEmail(email, testOrder);
    
    if (emailSent) {
      console.log("✅ TEST EMAIL SENT SUCCESSFULLY\n");
      res.json({ 
        success: true, 
        message: "✅ Test email sent successfully! Check your inbox (and spam folder) in 1-2 minutes.", 
        recipient: email 
      });
    } else {
      console.log("❌ TEST EMAIL FAILED - Check logs above for details\n");
      res.status(500).json({ 
        success: false, 
        error: "Email send failed", 
        details: "Check server logs for detailed error messages"
      });
    }
  } catch (error) {
    console.error("❌ Test email exception:", error.message);
    res.status(500).json({ 
      success: false, 
      error: "Failed to send test email", 
      details: error.message 
    });
  }
});

/* ===============================   �🚀 START SERVER
   =============================== */
// 🚀 START SERVER
const PORT = process.env.PORT || 3000;

/* ===============================
   📧 EMAIL QUEUE MANAGEMENT
   =============================== */
app.get("/email-monitor", (req, res) => {
  res.sendFile(path.join(__dirname, "email-monitor.html"));
});

app.get("/api/email-queue/status", requireAdmin, (req, res) => {
  try {
    const stats = emailQueue.getQueueStats();
    const logs = emailQueue.getEmailLogs(10);
    res.json({ 
      queueStats: stats,
      recentLogs: logs,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/email-queue/logs", requireAdmin, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const logs = emailQueue.getEmailLogs(limit);
    res.json({ logs, count: logs.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/email-queue/retry-all", requireAdmin, (req, res) => {
  try {
    const queue = emailQueue.loadQueue();
    const processedCount = queue.length;
    
    queue.forEach(item => {
      item.nextRetry = new Date().toISOString();
      item.status = 'pending';
    });
    
    emailQueue.saveQueue(queue);
    res.json({ 
      message: `${processedCount} emails marked for immediate retry`,
      queued: processedCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/email-queue/clear", requireAdmin, (req, res) => {
  try {
    emailQueue.saveQueue([]);
    res.json({ message: "Email queue cleared successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log("\n" + "=".repeat(50));
  console.log("🚀 UA ELECTRONICS SERVER STARTED");
  console.log("=".repeat(50));
  console.log(`📱 Server running on port: ${PORT}`);
  console.log(`📧 Email: ${process.env.EMAIL_USER ? "✅ Configured" : "❌ Not configured"}`);
  console.log(`💳 Payment Method: ✅ Razorpay Standard Checkout + COD available`);
  console.log(`📄 PDF Order Receipts: ✅ Auto-generated and stored in /Orders folder`);
  console.log("=".repeat(50) + "\n");
});