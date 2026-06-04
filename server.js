// ✅ CRITICAL: Force IPv4 DNS BEFORE loading any modules
// This prevents nodemailer from attempting IPv6 on Render
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const sendEmail = require("./email");
const emailQueue = require("./email-queue");
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

app.get("/api/email-queue/status", (req, res) => {
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

app.get("/api/email-queue/logs", (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const logs = emailQueue.getEmailLogs(limit);
    res.json({ logs, count: logs.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/email-queue/retry-all", (req, res) => {
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

app.delete("/api/email-queue/clear", (req, res) => {
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
  console.log(`💳 Payment Method: ✅ Cash on Delivery (COD) Only`);
  console.log(`📄 PDF Order Receipts: ✅ Auto-generated and stored in /Orders folder`);
  console.log("=".repeat(50) + "\n");
});