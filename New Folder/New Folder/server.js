const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const nodemailer = require("nodemailer");
const Razorpay = require("razorpay");
const PDFDocument = require("pdfkit");

const app = express();

app.use(cors());
app.use(express.json());

// ✅ Serve frontend
app.use(express.static(__dirname));

// ✅ Serve Orders folder (PDFs)
app.use('/Orders', express.static(path.join(__dirname, 'Orders')));

const DATA_FILE = path.join(__dirname, "data", "orders.json");
const ORDERS_PDF_DIR = path.join(__dirname, "Orders");

// Ensure directories exist
if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}
if (!fs.existsSync(ORDERS_PDF_DIR)) {
  fs.mkdirSync(ORDERS_PDF_DIR, { recursive: true });
}

/* ===============================
   📩 EMAIL SETUP (GMAIL)
   =============================== */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
   user: "yourrealemail@gmail.com",
pass: "your-google-app-password"      
  }
});

/* ===============================
   💳 RAZORPAY SETUP
   =============================== */
const razorpay = new Razorpay({
key_id: "rzp_test_xxxxxxxx",
key_secret: "xxxxxxxx"   
});

/* ===============================
   ✅ SAVE ORDER
   =============================== */
app.post("/save-order", (req, res) => {
  try {
    const newOrder = req.body;

    // ✅ Default values (safety)
    newOrder.paymentStatus = newOrder.paymentStatus || "PENDING";
    newOrder.paymentMethod = newOrder.paymentMethod || "UNKNOWN";
    newOrder.paymentId = newOrder.paymentId || null;

    // ✅ Validation
    if (!newOrder || !newOrder.orderId) {
      return res.status(400).json({ error: "Invalid order data" });
    }

    // ✅ Read existing orders
    let orders = [];
    if (fs.existsSync(DATA_FILE)) {
      orders = JSON.parse(fs.readFileSync(DATA_FILE));
    }

    // ✅ Add new order
    orders.push(newOrder);

    // ✅ Save file
    fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));

    // 📩 Send Email
    if (newOrder.user?.email) {
      transporter.sendMail({
        from: "UA Electronics",
        to: newOrder.user.email,
        subject: "Order Confirmed",
        html: `
          <h2>Order Confirmed ✅</h2>
          <p>Thank you for shopping with UA Electronics</p>
          <p><b>Order ID:</b> ${newOrder.orderId}</p>
          <p><b>Total:</b> ₹${(newOrder.grand || 0).toLocaleString("en-IN")}</p>
        `
      }, (err, info) => {
        if (err) console.log("Email error:", err);
      });
    }

    // ✅ Success response
    res.json({ success: true });

  } catch (err) {
    console.error("❌ Save order error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
/* ===============================
   📦 GET ALL ORDERS
   =============================== */
app.get("/orders", (req, res) => {
  const orders = JSON.parse(fs.readFileSync(DATA_FILE));
  res.json(orders);
});

/* ===============================
   🗑 DELETE ORDER
   =============================== */
app.delete("/delete-order/:id", (req, res) => {
  const id = req.params.id;

  let orders = JSON.parse(fs.readFileSync(DATA_FILE));
  orders = orders.filter(o => o.orderId !== id);

  fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));

  res.json({ success: true });
});

/* ===============================
   ✏️ UPDATE STATUS
   =============================== */
app.post("/update-status", (req, res) => {
  const { orderId, status } = req.body;

  let orders = JSON.parse(fs.readFileSync(DATA_FILE));

  orders = orders.map(o => {
    if (o.orderId === orderId) {
      o.status = status;
    }
    return o;
  });

  fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));

  res.json({ success: true });
});

/* ===============================
   📦 TRACK ORDER
   =============================== */
app.get("/track/:id", (req, res) => {
  const id = req.params.id.toLowerCase().trim();

  const orders = JSON.parse(fs.readFileSync(DATA_FILE));

  const order = orders.find(o =>
    o.orderId?.toLowerCase() === id ||
    o.orderId?.toLowerCase().includes(id)
  );

  if (!order) {
    return res.json({ error: "Order not found" });
  }

  res.json(order);
});
/* ===============================
   💳 CREATE RAZORPAY ORDER
   =============================== */
app.post("/create-order", async (req, res) => {
  try {
    const amount = req.body.amount;

    if (!amount || isNaN(amount)) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const options = {
      amount: amount * 100, // paise
      currency: "INR"
    };

    const order = await razorpay.orders.create(options);
    res.json(order);

  } catch (err) {
    console.error("Razorpay Error:", err);
    res.status(500).json({ error: "Error creating Razorpay order" });
  }
});

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
    
    const items = orderData.cart || orderData.items || [];
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
doc.text("For queries, contact: support@uaelectronicsindia.com | Phone: +91-96503-55125-UA-RIKON", { align: "center" });
doc.text("Pan India Delivery • 1 Year Warranty • 10-Day Easy Returns", { align: "center" });

// ✅ Correct order
doc.end();
console.log("📄 PDF document stream completed, waiting for write finish...");
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
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});