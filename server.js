const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const sendEmail = require("./email");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");

// Load environment variables
require('dotenv').config();

const app = express();
app.use(express.static('public'));
 
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// ✅ Serve frontend
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ✅ Serve Orders folder (PDFs)
app.use('/Orders', express.static(path.join(__dirname, 'Orders')));

const DATA_FILE = path.join(__dirname, "data", "orders.json");
const PRODUCTS_FILE = path.join(__dirname, "data", "products.json");
const USERS_FILE = path.join(__dirname, "data", "users.json");
const ORDERS_PDF_DIR = path.join(__dirname, "Orders");

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
   👤 USER REGISTRATION
   =============================== */
app.post("/register", (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: "All fields required" });
    }

    let users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    
    // Check if user already exists
    if (users.find(u => u.email === email)) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const newUser = {
      id: Date.now().toString(),
      email,
      password: Buffer.from(password).toString("base64"), // Basic encoding (not for production)
      name,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

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

    let users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    const user = users.find(u => u.email === email && u.password === Buffer.from(password).toString("base64"));

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({ success: true, userId: user.id, name: user.name, email: user.email });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* ===============================
   📩 EMAIL SETUP (GMAIL)
   =============================== */
// ✅ Transporter (you already have this)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER || "rikon@uaelectronicsindia.com",
    pass: process.env.GMAIL_PASS || "oyuhmygqokqcyegh"
  }
});

// ✅ Verify connection (you already have this)
transporter.verify((error, success) => {
  if (error) {
    console.warn("⚠️ Email transporter not configured or error:", error.message);
  } else {
    console.log("✅ Email transporter ready!");
  }
});




/* ===============================
   💳 PAYMENT METHOD: CASH ON DELIVERY ONLY
   =============================== */
// Online payments disabled - Only Cash on Delivery (COD) is available
console.log("✅ Payment Method: Cash on Delivery (COD) Only - No Online Payments");

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
          resolve({ success: true, fileName, filePath: `/Orders/${fileName}` });
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


app.post("/save-order", (req, res) => {
  try {
    const newOrder = req.body;

    // Validation
    if (!newOrder || !newOrder.items || newOrder.items.length === 0) {
      console.error("❌ Invalid order data - no items");
      return res.status(400).json({ error: "No items in order", success: false });
    }

    if (!newOrder.customer || !newOrder.customer.email) {
      console.error("❌ Invalid order data - no customer email");
      return res.status(400).json({ error: "Customer email required", success: false });
    }

    // Generate Order ID if not present
    if (!newOrder.orderId) {
      newOrder.orderId = "UAE" + Date.now();
    }

    // Add timestamp if not present
    if (!newOrder.date) {
      newOrder.date = new Date().toISOString();
    }

    console.log("📝 Saving order:", newOrder.orderId);

    let orders = [];
    try {
      orders = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    } catch (e) {
      orders = [];
    }

    orders.push(newOrder);
    fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));
    
    console.log("✅ Order saved successfully:", newOrder.orderId);

    // 📩 Send Email - async, don't wait for it
    if (newOrder.customer?.email) {
      sendEmail(newOrder.customer.email, newOrder).catch(err => {
        console.error("⚠️ Email sending error:", err.message);
      });
    }

    // 📄 Generate PDF - async
    if (newOrder.orderId) {
      // Call PDF generation in background
      generateOrderPDF(newOrder).catch(err => {
        console.error("⚠️ PDF generation error:", err.message);
      });
    }

    res.json({ success: true, orderId: newOrder.orderId, message: "Order placed successfully" });
  } catch (err) {
    console.error("❌ Order save error:", err);
    res.status(500).json({ error: "Failed to save order", details: err.message, success: false });
  }
});

/* ===============================
   📦 GET ALL ORDERS
   =============================== */
app.get("/orders", (req, res) => {
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
app.delete("/delete-order/:id", (req, res) => {
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
app.post("/update-status", (req, res) => {
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
    const id = req.params.id.toLowerCase().trim();

    const orders = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));

    const order = orders.find(o =>
      o.orderId?.toLowerCase() === id ||
      o.orderId?.toLowerCase().includes(id)
    );

    if (!order) {
      return res.json({ error: "Order not found" });
    }

    res.json(order);
  } catch (err) {
    console.error("Track order error:", err);
    res.status(500).json({ error: "Failed to track order" });
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
    
    if (!orderData || !orderData.orderId) {
      console.error("❌ Invalid order data received");
      return res.status(400).json({ error: "Invalid order data" });
    }

    // Ensure Orders directory exists
    if (!fs.existsSync(ORDERS_PDF_DIR)) {
      console.log("📁 Creating Orders directory:", ORDERS_PDF_DIR);
      fs.mkdirSync(ORDERS_PDF_DIR, { recursive: true });
    }

    const fileName = `${orderData.orderId}-receipt.pdf`;
    const filePath = path.join(ORDERS_PDF_DIR, fileName);
    
    console.log("📝 Generating PDF:", filePath);

    // Create PDF
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

    // Delivery Time Info (NEW)
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
    
    // Separator line
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
    doc.text("For queries, contact: support@uaelectronicsindia.com | Phone: 1800-UA-RIKON", { align: "center" });
    doc.text("Pan India Delivery • 1 Year Warranty • 10-Day Easy Returns", { align: "center" });

    console.log("📄 PDF document stream completed, waiting for write finish...");
    doc.end();

  } catch (err) {
    console.error("❌ PDF generation exception:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDF: " + err.message });
    }
  }
});

/* ===============================
   �🚀 START SERVER
   =============================== */
// 🚀 START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("\n" + "=".repeat(50));
  console.log("🚀 UA ELECTRONICS SERVER STARTED");
  console.log("=".repeat(50));
  console.log(`📱 Server running on port: ${PORT}`);
console.log(`📧 Email: ${process.env.EMAIL_USER ? "✅ Configured" : "❌ Not configured"}`);
  console.log(`💳 Payment Method: ✅ Cash on Delivery (COD) Only`);
  console.log(`📄 PDF Order Receipts: ✅ Auto-generated and stored in /Orders folder`);
  console.log("=".repeat(50) + "\n");
});