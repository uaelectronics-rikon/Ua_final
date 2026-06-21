const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

require('dotenv').config();
const emailQueue = require("./email-queue");

const GMAIL_USER = process.env.EMAIL_USER;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// ============================================
// VALIDATION
// ============================================
if (!GMAIL_USER) {
  console.error("\n❌ EMAIL_USER not set (e.g., rikon@uaelectronicsindia.com)");
}

if (!GMAIL_REFRESH_TOKEN || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("\n❌ Gmail API credentials missing!");
  console.error("   Required environment variables:");
  console.error("   - GMAIL_REFRESH_TOKEN");
  console.error("   - GOOGLE_CLIENT_ID");
  console.error("   - GOOGLE_CLIENT_SECRET");
  console.error("\n📚 Setup guide: See 'Gmail API Setup' section below");
}

// ============================================
// GMAIL API OAUTH CLIENT
// ============================================
let oauth2Client = null;
let gmail = null;

function initializeGmailAPI() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    console.error("❌ Cannot initialize Gmail API — credentials missing");
    return false;
  }

  try {
    oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      'http://localhost:3000/oauth2callback' // Redirect URI (not used in this flow)
    );

    oauth2Client.setCredentials({
      refresh_token: GMAIL_REFRESH_TOKEN,
    });

    gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    console.log("✅ Gmail API initialized");
    return true;
  } catch (error) {
    console.error("❌ Gmail API initialization failed:", error.message);
    return false;
  }
}

// Initialize on startup
if (GMAIL_USER && GMAIL_REFRESH_TOKEN && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  initializeGmailAPI();
  console.log("📧 Email service: Gmail API (Google Workspace)");
  console.log("📧 Account: " + GMAIL_USER);
  console.log("📧 Method: Gmail API v1 (no SMTP needed)");
  console.log("✅ EMAIL SERVICE READY\n");
} else {
  console.error("❌ FATAL: Gmail API not configured — missing credentials\n");
}

// ============================================
// HELPERS
// ============================================
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function encodeBase64(text) {
  return Buffer.from(text).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}


// ============================================
// SEND EMAIL WITH GMAIL API
// ============================================
async function sendEmailWithGmailAPI(mailOptions, retries = 5, delay = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`📤 Sending email (Attempt ${attempt}/${retries})...`);
      console.log(`   To: ${mailOptions.to}`);
      console.log(`   Subject: ${mailOptions.subject}`);

      if (!gmail) {
        throw new Error("Gmail API not initialized — check credentials");
      }

      // Define these here so both the simple and multipart paths use the same values
      const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@uaelectronicsindia.com>`;
      const timestamp = new Date().toUTCString();

      // Build MIME message
      let mimeMessage = `From: ${mailOptions.from}\r\n`;
mimeMessage += `To: ${mailOptions.to}\r\n`;
mimeMessage += `Subject: =?UTF-8?B?${Buffer.from(mailOptions.subject).toString('base64')}?=\r\n`;
mimeMessage += `Date: ${timestamp}\r\n`;
mimeMessage += `Message-ID: ${messageId}\r\n`;
mimeMessage += `MIME-Version: 1.0\r\n`;
mimeMessage += `Content-Type: text/html; charset="UTF-8"\r\n`;
mimeMessage += `Reply-To: ${GMAIL_USER}\r\n`;
mimeMessage += `\r\n`;
mimeMessage += mailOptions.html;

      // Add attachments if present
     if (mailOptions.attachments && mailOptions.attachments.length > 0) {
  const boundary = '===============boundary' + Date.now() + '==';
  const encodedSubject = `=?UTF-8?B?${Buffer.from(mailOptions.subject).toString('base64')}?=`;

mimeMessage = [
  `From: ${mailOptions.from}`,
  `To: ${mailOptions.to}`,
  `Subject: ${encodedSubject}`,
  `Date: ${timestamp}`,
  `Message-ID: ${messageId}`,
  `MIME-Version: 1.0`,
  `Content-Type: multipart/mixed; boundary="${boundary}"`,
  `Reply-To: ${GMAIL_USER}`,
  ``,
  `--${boundary}`,
  `Content-Type: text/html; charset="UTF-8"`,
  `Content-Transfer-Encoding: base64`,
  ``,
  Buffer.from(mailOptions.html).toString('base64'),
  ``
].join('\r\n');

  for (const attachment of mailOptions.attachments) {
    const fileContent = fs.readFileSync(attachment.path);
    const base64Content = fileContent.toString('base64');
    mimeMessage += [
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      base64Content,
      ``
    ].join('\r\n');
  }

  mimeMessage += `--${boundary}--`;
}

      // Encode message
      const encodedMessage = encodeBase64(mimeMessage);

      // Send via Gmail API
      const result = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      console.log(`✅ Email sent on attempt ${attempt}`);
      console.log(`   Message ID: ${result.data.id}`);
      return { success: true, messageId: result.data.id };

    } catch (error) {
      console.error(`\n❌ Attempt ${attempt} FAILED`);
      console.error(`   Error: ${error.message}`);
      console.error(`   Code: ${error.code || 'N/A'}`);

      // Authentication failed — no point retrying
      if (error.message.includes('invalid_grant') || error.message.includes('UNAUTHENTICATED')) {
        console.error("🔧 AUTH FAILED: Check GMAIL_REFRESH_TOKEN in Render env vars");
        throw error;
      }

      if (attempt < retries) {
        const waitTime = delay * Math.pow(2, attempt - 1);
        console.log(`⏳ Retrying in ${waitTime / 1000}s...`);
        await new Promise(r => setTimeout(r, waitTime));
      } else {
        console.error("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.error("❌ All email attempts FAILED");
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        throw error;
      }
    }
  }
}

// ============================================
// BUILD EMAIL HTML — SAMSUNG PREMIUM BLUE THEME
// ============================================
function buildEmailHTML(orderData, customerName, orderDate, itemsHtml) {
  return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <title>Order Confirmed - UA Electronics</title>
        <style>
/* ══════════════════════════════════════════════════════════ */
/* SAMSUNG PREMIUM BLUE THEME - EMAIL TEMPLATE */
/* ══════════════════════════════════════════════════════════ */

/* RESET & GLOBAL STYLES */
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
  line-height: 1.6;
  color: #111111;
  background: #F5F7FA;
}

.container {
  max-width: 600px;
  margin: 0 auto;
  background: #ffffff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 12px 48px rgba(20, 40, 160, 0.12);
}

/* ══════════════════════════════════════════════════════════ */
/* HEADER - PREMIUM GRADIENT */
/* ══════════════════════════════════════════════════════════ */
.header {
  background: linear-gradient(135deg, #1428A0 0%, #2189FF 100%);
  color: #ffffff;
  padding: 40px 30px;
  text-align: center;
  position: relative;
  overflow: hidden;
}

.header::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
}

.header h1 {
  margin: 0 0 8px 0;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.5px;
  position: relative;
  z-index: 1;
}

.header-badge {
  display: inline-block;
  background: rgba(255,255,255,0.15);
  color: #ffffff;
  padding: 8px 16px;
  border-radius: 24px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  margin-top: 8px;
  position: relative;
  z-index: 1;
}

.header p {
  margin: 12px 0 0;
  color: rgba(255,255,255,0.9);
  font-size: 14px;
  position: relative;
  z-index: 1;
}

/* ══════════════════════════════════════════════════════════ */
/* CONTENT SECTION */
/* ══════════════════════════════════════════════════════════ */
.content {
  padding: 32px;
  background: #F5F7FA;
}

/* GREETING CARD */
.greeting-card {
  background: #ffffff;
  padding: 24px;
  border-radius: 10px;
  margin-bottom: 24px;
  border-left: 4px solid #2189FF;
  box-shadow: 0 4px 12px rgba(20, 40, 160, 0.08);
}

.greeting-card h2 {
  color: #0F172A;
  font-size: 18px;
  margin-bottom: 8px;
  font-weight: 700;
}

.greeting-card > p:nth-of-type(1) {
  color: #333333;
  margin-bottom: 12px;
  font-size: 14px;
}

/* ORDER STATUS SECTION */
.order-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #E5E7EB;
}

.order-id-block {
  flex: 1;
}

.order-id-label {
  display: block;
  color: #666666;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.order-id-value {
  display: block;
  color: #1428A0;
  font-size: 18px;
  font-weight: 700;
}

.order-date {
  color: #666666;
  font-size: 12px;
}

.status-badge {
  background: linear-gradient(135deg, #2189FF, #4DA3FF);
  color: #ffffff;
  padding: 8px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

/* ══════════════════════════════════════════════════════════ */
/* SECTION TITLES */
/* ══════════════════════════════════════════════════════════ */
.section-title {
  color: #1428A0;
  font-size: 14px;
  font-weight: 700;
  margin-top: 28px;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 2px solid #2189FF;
  letter-spacing: 0.3px;
}

/* ══════════════════════════════════════════════════════════ */
/* INFO CARDS */
/* ══════════════════════════════════════════════════════════ */
.info-card {
  background: #ffffff;
  padding: 18px;
  border-radius: 10px;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(20, 40, 160, 0.06);
}

.info-card p {
  margin: 8px 0;
  font-size: 13px;
  line-height: 1.6;
}

.info-card strong {
  color: #0F172A;
  font-weight: 700;
  display: inline-block;
  min-width: 100px;
}

.info-card em {
  color: #2189FF;
  font-style: normal;
  font-weight: 600;
}

/* ══════════════════════════════════════════════════════════ */
/* ITEMS TABLE - PREMIUM STYLING */
/* ══════════════════════════════════════════════════════════ */
.items-table {
  width: 100%;
  border-collapse: collapse;
  background: #ffffff;
  margin-bottom: 20px;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(20, 40, 160, 0.06);
}

.items-table thead {
  background: #1428A0;
  color: #ffffff;
}

.items-table th {
  padding: 14px 12px;
  text-align: left;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.items-table td {
  padding: 14px 12px;
  border-bottom: 1px solid #E5E7EB;
  font-size: 13px;
}

.items-table tbody tr:nth-child(even) {
  background: #F8FAFC;
}

.items-table tbody tr:hover {
  background: #F0F2F8;
}

.items-table th:nth-child(2),
.items-table td:nth-child(2) {
  text-align: center;
  width: 60px;
}

.items-table th:nth-child(3),
.items-table td:nth-child(3),
.items-table th:nth-child(4),
.items-table td:nth-child(4) {
  text-align: right;
}

.item-name {
  color: #0F172A;
  font-weight: 600;
}

.item-qty {
  color: #333333;
  font-weight: 700;
}

.item-price, .item-subtotal {
  color: #1428A0;
  font-weight: 700;
}

/* ══════════════════════════════════════════════════════════ */
/* PRICING SECTION */
/* ══════════════════════════════════════════════════════════ */
.pricing-card {
  background: #ffffff;
  padding: 22px;
  border-radius: 10px;
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(20, 40, 160, 0.06);
}

.price-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #E5E7EB;
  font-size: 13px;
}

.price-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.price-label {
  color: #333333;
  font-weight: 600;
}

.price-value {
  color: #0F172A;
  font-weight: 700;
  text-align: right;
}

.grand-total-box {
  background: linear-gradient(135deg, #1428A0 0%, #2189FF 100%);
  color: #ffffff;
  padding: 20px;
  border-radius: 10px;
  margin-top: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.grand-total-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  opacity: 0.95;
}

.grand-total-amount {
  font-size: 24px;
  font-weight: 700;
}

/* ══════════════════════════════════════════════════════════ */
/* TIMELINE / DELIVERY INFO */
/* ══════════════════════════════════════════════════════════ */
.timeline-card {
  background: linear-gradient(135deg, rgba(33, 137, 255, 0.05), rgba(77, 163, 255, 0.05));
  border: 1px solid #4DA3FF;
  border-left: 4px solid #2189FF;
  padding: 20px;
  border-radius: 10px;
  margin-bottom: 20px;
}

.timeline-card h4 {
  color: #1428A0;
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 10px;
  margin-top: 0;
}

.timeline-card p {
  margin: 8px 0;
  font-size: 13px;
  color: #333333;
  line-height: 1.5;
}

.timeline-duration {
  color: #1428A0;
  font-weight: 700;
  font-size: 14px;
}

/* ══════════════════════════════════════════════════════════ */
/* BENEFITS SECTION */
/* ══════════════════════════════════════════════════════════ */
.benefits-card {
  background: #ffffff;
  padding: 20px;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(20, 40, 160, 0.06);
}

.benefits-card h4 {
  color: #0F172A;
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 14px;
  margin-top: 0;
}

.benefits-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.benefits-list li {
  padding: 8px 0;
  font-size: 13px;
  color: #333333;
  border-bottom: 1px solid #E5E7EB;
}

.benefits-list li:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.benefits-icon {
  color: #2189FF;
  font-weight: 700;
  margin-right: 8px;
}

/* ══════════════════════════════════════════════════════════ */
/* FOOTER - DARK NAVY PREMIUM STYLE */
/* ══════════════════════════════════════════════════════════ */
.footer {
  background: #0F172A;
  color: #CBD5E1;
  padding: 30px 24px;
  text-align: center;
  font-size: 12px;
}

.footer-brand {
  font-size: 13px;
  font-weight: 700;
  color: #4DA3FF;
  margin-bottom: 12px;
}

.footer-contact {
  margin: 8px 0;
  font-size: 12px;
}

.footer-link {
  color: #4DA3FF;
  text-decoration: none;
  font-weight: 600;
  display: inline-block;
  margin: 0 6px;
}

.footer-link:hover {
  color: #ffffff;
  text-decoration: underline;
}

.footer-divider {
  height: 1px;
  background: rgba(77, 163, 255, 0.2);
  margin: 16px 0;
}

.footer-info {
  font-size: 11px;
  color: #94A3B8;
  line-height: 1.6;
}

.footer-info a {
  color: #2189FF;
  text-decoration: none;
}

/* ══════════════════════════════════════════════════════════ */
/* RESPONSIVE MOBILE STYLES */
/* ══════════════════════════════════════════════════════════ */
@media only screen and (max-width: 600px) {
  .container { border-radius: 0; }
  .content { padding: 20px; }
  .header { padding: 30px 20px; }
  .header h1 { font-size: 24px; }
  .greeting-card { padding: 18px; }
  .pricing-card { padding: 16px; }
  .grand-total-box { flex-direction: column; text-align: center; }
  .grand-total-label { margin-bottom: 8px; }
  .items-table { font-size: 12px; }
  .items-table th, .items-table td { padding: 10px 8px; }
}

/* ══════════════════════════════════════════════════════════ */
/* GMAIL OPTIMIZATIONS */
/* ══════════════════════════════════════════════════════════ */
img { border: 0; outline: 0; text-decoration: none; display: block; }
a { color: #2189FF; text-decoration: none; }
table { border-collapse: collapse; width: 100%; }
u + .body .gmail { width: 100vw; }
</style>
      </head>
      <body>
        <div class="container">
          <!-- HEADER -->
          <div class="header">
            <h1>✅ Order Confirmed</h1>
            <div class="header-badge">Thank You for Your Purchase</div>
            <p>Your order is being processed with care</p>
          </div>

          <!-- MAIN CONTENT -->
          <div class="content">

            <!-- GREETING CARD -->
            <div class="greeting-card">
              <h2>Hello, ${customerName}! 👋</h2>
              <p>Your order has been successfully placed and is now being prepared for shipment.</p>
              <div class="order-status">
                <div class="order-id-block">
                  <span class="order-id-label">Order ID</span>
                  <span class="order-id-value">${orderData.orderId}</span>
                  <div class="order-date">Placed on: ${orderDate}</div>
                </div>
                <div class="status-badge">Status: ${orderData.status || 'Confirmed'}</div>
              </div>
            </div>

            <!-- DELIVERY INFORMATION -->
            <div class="section-title">📍 Delivery Information</div>
            <div class="info-card">
              <p><strong>Name:</strong> <em>${orderData.customer?.name || 'N/A'}</em></p>
              <p><strong>Email:</strong> <em>${orderData.customer?.email || 'N/A'}</em></p>
              <p><strong>Mobile:</strong> <em>${orderData.customer?.mobile || 'N/A'}</em></p>
              <p><strong>Address:</strong> <em>${orderData.customer?.addr1 || ''}${orderData.customer?.addr2 ? ', ' + orderData.customer.addr2 : ''}</em></p>
              <p><strong>City:</strong> <em>${orderData.customer?.city || 'N/A'} - ${orderData.customer?.pin || 'N/A'}</em></p>
              <p><strong>State:</strong> <em>${orderData.customer?.state || 'N/A'}</em></p>
              ${orderData.customer?.notes ? `<p><strong>Special Notes:</strong> <em>${orderData.customer.notes}</em></p>` : ''}
            </div>

            <!-- ORDER ITEMS TABLE -->
            <div class="section-title">📦 Order Items</div>
            <table class="items-table">
              <thead>
                <tr>
                  <th>Product Name</th>
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>${itemsHtml}</tbody>
            </table>

            <!-- PRICING SUMMARY -->
            <div class="pricing-card">
              <div class="price-row">
                <span class="price-label">Subtotal</span>
                <span class="price-value">₹${(orderData.subtotal || 0).toLocaleString('en-IN')}</span>
              </div>
              <div class="price-row">
                <span class="price-label">Delivery Charge</span>
                <span class="price-value">₹${(orderData.shipping || 0).toLocaleString('en-IN')}</span>
              </div>
              <div class="grand-total-box">
                <div>
                  <div class="grand-total-label">Total Amount</div>
                </div>
                <div class="grand-total-amount">₹${(orderData.grand || 0).toLocaleString('en-IN')}</div>
              </div>
            </div>

            <!-- PAYMENT INFORMATION -->
            <div class="section-title">💳 Payment Information</div>
            <div class="info-card">
              <p><strong>Payment Method:</strong> <em>${orderData.paymentMethod === 'online' ? '💳 Online (Razorpay)' : '💵 Cash on Delivery (COD)'}</em></p>
              <p><strong>Payment Status:</strong> <em>${orderData.paymentStatus || 'Pending'}</em></p>
            </div>

            <!-- DELIVERY TIMELINE -->
            <div class="timeline-card">
              <h4>⏱️ Estimated Delivery Timeline</h4>
              <p class="timeline-duration">📅 2–8 Working Days</p>
              <p>Your order will be carefully packed and shipped soon. You'll receive a tracking update and shipping notification via email shortly.</p>
            </div>

            <!-- WHY UA ELECTRONICS -->
            <div class="section-title">✨ Why Choose UA Electronics?</div>
            <div class="benefits-card">
              <ul class="benefits-list">
                <li><span class="benefits-icon">✓</span> <strong>Pan India Delivery</strong> — Fast & reliable shipping to your doorstep</li>
                <li><span class="benefits-icon">✓</span> <strong>1 Year Manufacturer Warranty</strong> — Full protection on all products</li>
                <li><span class="benefits-icon">✓</span> <strong>10-Day Easy Returns</strong> — Hassle-free return policy</li>
                <li><span class="benefits-icon">✓</span> <strong>24/7 Customer Support</strong> — Always here to help</li>
              </ul>
            </div>

          </div>

          <!-- FOOTER -->
          <div class="footer">
            <div class="footer-brand">🔧 UA ELECTRONICS — Premium Electronics Retailer</div>
            <p style="margin: 12px 0 8px 0; font-size: 12px;">
              <strong style="color: #F5F7FA;">Need Help? Contact Us</strong>
            </p>
            <p class="footer-contact">
              <a href="mailto:rikon@uaelectronicsindia.com" class="footer-link">📧 rikon@uaelectronicsindia.com</a>
            </p>
            <p class="footer-contact">
              <a href="https://uaelectronicsindia.com" class="footer-link">🌐 uaelectronicsindia.com</a>
            </p>
            <div class="footer-divider"></div>
            <div class="footer-info">
              <p style="margin: 0 0 6px 0;">© 2026 UA Electronics. All rights reserved.</p>
              <p style="margin: 0;">This is an automated email — please do not reply.</p>
              <p style="margin: 6px 0 0 0;">
                <a href="mailto:rikon@uaelectronicsindia.com?subject=Unsubscribe">Manage Email Preferences</a>
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
}

// ============================================
// MAIN SEND EMAIL FUNCTION
// ============================================
async function sendEmail(to, orderData, pdfFilePath = null) {
  try {
    if (!validateEmail(to)) {
      console.error(`❌ Invalid email address: ${to}`);
      return false;
    }

    if (!gmail) {
      console.error("❌ Gmail API not initialized");
      return false;
    }

    // Build items HTML
    let itemsHtml = '';
    if (orderData.items && orderData.items.length > 0) {
      orderData.items.forEach((item, index) => {
        const bgColor = index % 2 === 0 ? 'transparent' : '#F8FAFC';
        itemsHtml += `
          <tr style="background-color: ${bgColor};">
            <td style="padding: 14px 12px; border-bottom: 1px solid #E5E7EB; font-size: 13px;"><span class="item-name">${item.name}</span></td>
            <td style="padding: 14px 12px; border-bottom: 1px solid #E5E7EB; text-align: center; font-size: 13px;"><span class="item-qty">×${item.qty}</span></td>
            <td style="padding: 14px 12px; border-bottom: 1px solid #E5E7EB; text-align: right; font-size: 13px;"><span class="item-price">₹${(item.price || 0).toLocaleString('en-IN')}</span></td>
            <td style="padding: 14px 12px; border-bottom: 1px solid #E5E7EB; text-align: right; font-size: 13px;"><span class="item-subtotal">₹${(item.subtotal || 0).toLocaleString('en-IN')}</span></td>
          </tr>
        `;
      });
    }

    const customerName = orderData.customer?.name || 'Valued Customer';
    const orderDate = new Date(orderData.date || Date.now()).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric'
    });

    const mailOptions = {
      from: `"UA Electronics India" <${GMAIL_USER}>`,
      to,
subject: `Order Confirmation - ${orderData.orderId}`,      html: buildEmailHTML(orderData, customerName, orderDate, itemsHtml),
      attachments: []
    };

    // Add PDF if provided
    if (pdfFilePath && fs.existsSync(pdfFilePath)) {
      mailOptions.attachments.push({
        filename: `${orderData.orderId}-receipt.pdf`,
        path: pdfFilePath,
        contentType: 'application/pdf'
      });
      console.log(`📎 PDF attached: ${pdfFilePath}`);
    }

    await sendEmailWithGmailAPI(mailOptions);
    emailQueue.logEmail(to, orderData, true);
    console.log(`\n✅ ORDER EMAIL SENT — Order: ${orderData.orderId} → ${to}\n`);
    return true;

  } catch (error) {
    console.error(`\n❌ EMAIL FAILED for order: ${orderData.orderId}`);
    console.error(`   To: ${to} | Error: ${error.message}\n`);

    emailQueue.logEmail(to, orderData, false, error);
    emailQueue.addToQueue(to, orderData, pdfFilePath);
    return false;
  }
}

// ============================================
// QUEUE PROCESSING
// ============================================
async function processEmailQueue() {
  const queue = emailQueue.loadQueue();
  if (queue.length === 0) return;

  const pending = queue.filter(item => item.status === 'pending' && new Date(item.nextRetry) <= new Date());
  if (pending.length === 0) return;

  console.log(`\n📧 Processing email queue (${pending.length} ready to retry)...`);

  for (const item of pending) {
    try {
      console.log(`📧 Retrying email for order: ${item.orderData.orderId}`);
      const success = await sendEmail(item.to, item.orderData, item.pdfFilePath);

      if (success) {
        emailQueue.removeFromQueue(item.id);
        console.log(`✅ Queued email sent successfully`);
      } else {
        item.attempts = (item.attempts || 0) + 1;
        const delayMinutes = Math.min(300, Math.pow(2, item.attempts));
        item.nextRetry = new Date(Date.now() + delayMinutes * 60000).toISOString();
        if (item.attempts >= 10) {
          item.status = 'failed';
          console.error(`❌ Email permanently failed after 10 attempts: ${item.to}`);
        }
      }
    } catch (error) {
      console.error(`❌ Queue processing error: ${error.message}`);
    }
  }

  emailQueue.saveQueue(queue);
}

setInterval(processEmailQueue, 5 * 60 * 1000);

module.exports = sendEmail;