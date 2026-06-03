const nodemailer = require("nodemailer");
const dns = require("dns");
const net = require("net");

// ============================================
// CRITICAL: Force IPv4 DNS resolution globally
// This MUST come before any network operations
// ============================================
dns.setDefaultResultOrder("ipv4first");

require('dotenv').config();
const emailQueue = require("./email-queue");

const GMAIL_USER = process.env.EMAIL_USER;
const GMAIL_PASS = process.env.EMAIL_PASS;

// ============================================
// VALIDATION
// ============================================
if (!GMAIL_USER || !GMAIL_PASS) {
  console.error("\n❌ CRITICAL ERROR: Email credentials missing!");
  console.error("   Set EMAIL_USER and EMAIL_PASS in Render Environment Variables.");
  console.error("   EMAIL_PASS must be a 16-char Google App Password (not your Gmail password).");
  console.error("   Generate one at: https://myaccount.google.com/apppasswords\n");
}

// ============================================
// IPv4 RESOLUTION
// ============================================
// We resolve smtp.gmail.com to an IPv4 address ONCE and reuse it.
// This prevents nodemailer from ever using its own DNS lookup (which can return IPv6).
// Render blocks IPv6 outbound — this is the root cause of ENETUNREACH errors.
let GMAIL_SMTP_IP = null; // null until resolved; we wait before creating the transporter

async function resolveGmailIPv4() {
  return new Promise((resolve) => {
    // dns.resolve4 explicitly returns only A (IPv4) records
    dns.resolve4("smtp.gmail.com", (err, addresses) => {
      if (!err && addresses && addresses.length > 0) {
        // Pick the first IPv4 address
        const ip = addresses[0];
        console.log(`✅ smtp.gmail.com → ${ip} (IPv4 only)`);
        resolve(ip);
      } else {
        console.warn("⚠️  Could not resolve smtp.gmail.com to IPv4, will fall back to hostname");
        console.warn("   Error:", err?.message);
        resolve(null); // fall back to hostname — better than crashing
      }
    });
  });
}

// ============================================
// TRANSPORTER FACTORY
// ============================================
// Creates a fresh transporter using the already-resolved IPv4 address.
// Always use the IPv4 address (GMAIL_SMTP_IP) as the host, NEVER the hostname,
// so nodemailer cannot re-resolve it to IPv6.
// We set `family: 4` as a secondary safeguard.
function createTransporter(port, secure) {
  const host = GMAIL_SMTP_IP || "smtp.gmail.com";

  const config = {
    host,
    port,
    secure,           // true for 465, false for 587
    family: 4,        // FORCE IPv4 socket — belt-and-suspenders with pre-resolved IP

    auth: {
      user: GMAIL_USER,
      pass: GMAIL_PASS,
    },

    tls: {
      rejectUnauthorized: false,   // needed when connecting via IP (no hostname cert match)
      minVersion: "TLSv1.2",
      servername: "smtp.gmail.com" // SNI: tells Gmail which cert to serve despite IP host
    },

    // Generous timeouts for Render's occasionally slow network
    connectionTimeout: 30000,
    greetingTimeout: 20000,
    socketTimeout:   45000,

    pool: false,  // never pool — stale pooled sockets cause silent failures on Render

    debug: true,
    logger: true,
  };

  console.log(`🔧 Creating transporter: host=${host} port=${port} secure=${secure}`);
  return nodemailer.createTransport(config);
}

// The active transporter — initialized after IPv4 resolution
let transporter = null;
let transporterPort = 465;

// ============================================
// STARTUP INITIALIZATION
// ============================================
// We resolve IPv4, then create the transporter, then verify.
// All of this is async-safe via a promise chain.
let initializationDone = false;

const initializationPromise = (async () => {
  if (!GMAIL_USER || !GMAIL_PASS) {
    console.error("❌ Skipping transporter init — credentials missing.");
    initializationDone = true;
    return;
  }

  // Resolve IPv4 address (give it 3 attempts with a short delay)
  for (let i = 0; i < 3; i++) {
    GMAIL_SMTP_IP = await resolveGmailIPv4();
    if (GMAIL_SMTP_IP) break;
    if (i < 2) {
      console.log(`⏳ DNS retry ${i + 2}/3 in 3 seconds...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Try port 465 first, then fall back to 587 if verify fails
  const portConfigs = [
    { port: 465, secure: true  },
    { port: 587, secure: false },
  ];

  for (const { port, secure } of portConfigs) {
    transporter = createTransporter(port, secure);
    transporterPort = port;

    try {
      await transporter.verify();
      console.log(`\n✅ EMAIL SERVICE READY (port ${port})`);
      console.log(`   Account: ${GMAIL_USER}`);
      console.log(`   Host: ${GMAIL_SMTP_IP || "smtp.gmail.com"}\n`);
      initializationDone = true;
      return; // success — stop trying
    } catch (err) {
      console.warn(`⚠️  Port ${port} verify failed: ${err.message} (${err.code})`);
      if (err.code === "EAUTH") {
        // Wrong password — retrying a different port won't help
        console.error("❌ AUTHENTICATION FAILED — check EMAIL_PASS in Render env vars.");
        console.error("   It must be a 16-char App Password from https://myaccount.google.com/apppasswords");
        transporter = null;
        initializationDone = true;
        return;
      }
      transporter = null; // try next port
    }
  }

  // Both ports failed on verify — this can happen on Render at cold start due to
  // brief network unavailability. We keep transporter = null so ensureTransporter()
  // recreates it on first send attempt (by which time the network is usually stable).
  console.warn("⚠️  Both ports failed at startup. Will retry when first order is placed.");
  initializationDone = true;
})();

// ============================================
// ENSURE TRANSPORTER (lazy re-init on send)
// ============================================
async function ensureTransporter() {
  // Wait for the startup init to finish (in case an order comes in very fast)
  if (!initializationDone) {
    await initializationPromise;
  }

  if (transporter) return true;
  if (!GMAIL_USER || !GMAIL_PASS) return false;

  // Re-resolve IP in case it expired or never resolved at startup
  if (!GMAIL_SMTP_IP) {
    GMAIL_SMTP_IP = await resolveGmailIPv4();
  }

  // Try 465 first, then 587
  for (const { port, secure } of [{ port: 465, secure: true }, { port: 587, secure: false }]) {
    const t = createTransporter(port, secure);
    try {
      await t.verify();
      transporter = t;
      transporterPort = port;
      console.log(`✅ Transporter re-initialized (port ${port})`);
      return true;
    } catch (err) {
      console.warn(`⚠️  Port ${port} verify failed: ${err.message}`);
      if (err.code === "EAUTH") {
        console.error("❌ EAUTH: Wrong App Password. Fix EMAIL_PASS in Render env vars.");
        return false;
      }
    }
  }

  // Last resort: create without verify and let sendMail surface the error
  console.warn("⚠️  Could not verify transporter — will attempt send anyway (port 465)");
  transporter = createTransporter(465, true);
  return true;
}

// ============================================
// HELPERS
// ============================================
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================
// SEND WITH RETRY
// ============================================
// KEY FIX: We do NOT null out `transporter` between attempts.
// The old code set `transporter = null` before each retry, forcing nodemailer
// to re-create it — and re-run DNS lookup — which could resolve to IPv6 again.
// Instead we keep the same transporter (already locked to the IPv4 address)
// and only recreate it if sendMail throws a connection-level error.
async function sendEmailWithRetry(mailOptions, retries = 5, initialDelay = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`\n📤 Sending email (Attempt ${attempt}/${retries})...`);
    console.log(`   To: ${mailOptions.to}`);
    console.log(`   Subject: ${mailOptions.subject}`);

    const ready = await ensureTransporter();
    if (!ready) {
      throw new Error("Cannot initialize email transporter — check EMAIL_USER and EMAIL_PASS.");
    }

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ Email sent on attempt ${attempt} | MessageID: ${info.messageId}`);
      return { success: true, messageId: info.messageId };

    } catch (error) {
      console.error(`❌ Attempt ${attempt} FAILED — ${error.code || "UNKNOWN"}: ${error.message}`);
      if (process.env.NODE_ENV === "production") {
        console.error(`   Full: ${JSON.stringify(error)}`);
      }

      // Wrong credentials — no point retrying
      if (error.code === "EAUTH") {
        console.error("🔧 EAUTH: Fix EMAIL_PASS in Render → Environment Variables → Redeploy");
        throw error;
      }

      if (attempt < retries) {
        // Invalidate transporter on connection errors so ensureTransporter() rebuilds it
        // (re-resolves DNS, tries alternate port, etc.)
        if (["ESOCKET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "ECONNRESET"].includes(error.code)) {
          console.log("🔄 Will recreate transporter before next attempt...");
          transporter = null;
          // Re-resolve IPv4 — the previous address might have gone stale
          GMAIL_SMTP_IP = await resolveGmailIPv4();
        }

        const wait = initialDelay * Math.pow(2, attempt - 1); // 3s, 6s, 12s, 24s
        console.log(`⏳ Retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        console.error("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.error("❌ All email attempts FAILED");
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        if (["ESOCKET", "ETIMEDOUT", "ENETUNREACH"].includes(error.code)) {
          console.error("🔧 Network/IPv6 issue on Render:");
          console.error("   → The resolved IP may have changed to an IPv6 address mid-session.");
          console.error("   → Check Render status: https://status.render.com");
          console.error("   → Email queued for automatic retry in 5 minutes.");
        }
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        throw error;
      }
    }
  }
}

// ============================================
// BUILD EMAIL HTML
// ============================================
function buildEmailHTML(orderData, customerName, orderDate, itemsHtml) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
        .header { background: #080808; color: #C9A227; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 28px; }
        .header p { margin: 5px 0 0 0; color: #f5f0e8; font-size: 14px; }
        .content { padding: 30px; background: #f5f0e8; }
        .order-header { background: #fff; padding: 20px; border-left: 4px solid #C9A227; margin-bottom: 20px; border-radius: 4px; }
        .order-header h2 { color: #C9A227; margin-top: 0; }
        .order-id { font-size: 16px; font-weight: bold; color: #080808; }
        .section-title { color: #080808; font-size: 16px; font-weight: bold; margin-top: 20px; margin-bottom: 10px; border-bottom: 2px solid #C9A227; padding-bottom: 8px; }
        .info-box { background: #fff; padding: 15px; border-radius: 4px; margin-bottom: 15px; }
        .info-box p { margin: 5px 0; }
        .info-box strong { color: #080808; }
        .items-table { width: 100%; border-collapse: collapse; background: #fff; margin-bottom: 20px; border-radius: 4px; overflow: hidden; }
        .items-table th { background: #C9A227; color: #080808; padding: 12px; text-align: left; font-weight: bold; }
        .items-table th:nth-child(2), .items-table td:nth-child(2) { text-align: center; }
        .items-table th:nth-child(3), .items-table td:nth-child(3),
        .items-table th:nth-child(4), .items-table td:nth-child(4) { text-align: right; }
        .totals { background: #fff; padding: 20px; border-radius: 4px; margin-bottom: 20px; }
        .total-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .grand-total { background: #080808; color: #C9A227; padding: 15px; border-radius: 4px; font-size: 18px; font-weight: bold; display: flex; justify-content: space-between; margin-top: 10px; }
        .timeline { background: #fff; padding: 15px; border-radius: 4px; margin-bottom: 20px; border-left: 4px solid #C9A227; }
        .timeline h4 { color: #080808; margin-top: 0; }
        .badge { display: inline-block; background: #C9A227; color: #080808; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-top: 8px; }
        .footer { background: #080808; color: #f5f0e8; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px; }
        .footer a { color: #C9A227; text-decoration: none; }
        .divider { height: 1px; background: #C9A227; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Order Confirmed!</h1>
          <p>Thank you for shopping with UA Electronics</p>
        </div>
        <div class="content">
          <div class="order-header">
            <h2 style="margin-bottom: 10px;">Hello, ${customerName}! 👋</h2>
            <p style="color: #555; margin: 0 0 12px 0;">Your order has been placed successfully and is being processed.</p>
            <div class="order-id">Order ID: ${orderData.orderId}</div>
            <div style="color: #666; font-size: 14px; margin-top: 5px;">Placed on: ${orderDate}</div>
            <div class="badge">Status: ${orderData.status || 'Confirmed'}</div>
          </div>

          <div class="section-title">📍 Delivery Information</div>
          <div class="info-box">
            <p><strong>Name:</strong> ${orderData.customer?.name || 'N/A'}</p>
            <p><strong>Email:</strong> ${orderData.customer?.email || 'N/A'}</p>
            <p><strong>Mobile:</strong> ${orderData.customer?.mobile || 'N/A'}</p>
            <p><strong>Address:</strong> ${orderData.customer?.addr1 || ''}${orderData.customer?.addr2 ? ', ' + orderData.customer.addr2 : ''}</p>
            <p><strong>City:</strong> ${orderData.customer?.city || 'N/A'} - ${orderData.customer?.pin || 'N/A'}</p>
            <p><strong>State:</strong> ${orderData.customer?.state || 'N/A'}</p>
            ${orderData.customer?.notes ? `<p><strong>Special Notes:</strong> ${orderData.customer.notes}</p>` : ''}
          </div>

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

          <div class="totals">
            <div class="total-row">
              <span><strong>Subtotal:</strong></span>
              <span>₹${(orderData.subtotal || 0).toLocaleString('en-IN')}</span>
            </div>
            <div class="total-row">
              <span><strong>Delivery Charge:</strong></span>
              <span>₹${(orderData.shipping || 0).toLocaleString('en-IN')}</span>
            </div>
            <div class="grand-total">
              <span>TOTAL AMOUNT</span>
              <span>₹${(orderData.grand || 0).toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div class="section-title">💳 Payment Information</div>
          <div class="info-box">
            <p><strong>Payment Method:</strong> ${orderData.paymentMethod === 'online' ? '💳 Online (Razorpay)' : '💵 Cash on Delivery (COD)'}</p>
            <p><strong>Payment Status:</strong> ${orderData.paymentStatus || 'Pending'}</p>
          </div>

          <div class="timeline">
            <h4>⏱️ Estimated Delivery Timeline</h4>
            <p>📅 <strong>2–8 Working Days</strong></p>
            <p style="color: #666; margin: 0;">Your order will be processed and shipped soon. You'll receive a tracking update via email.</p>
          </div>

          <div class="info-box">
            <h4 style="color: #080808; margin-top: 0;">✨ Why UA Electronics?</h4>
            <ul style="margin: 8px 0; padding-left: 20px; color: #555;">
              <li>✅ Pan India Delivery</li>
              <li>✅ 1 Year Manufacturer Warranty</li>
              <li>✅ 10-Day Easy Returns</li>
              <li>✅ 24/7 Customer Support</li>
            </ul>
          </div>
        </div>
        <div class="footer">
          <p style="margin-bottom: 8px; font-size: 13px;"><strong>Need Help? Contact Us</strong></p>
          <p style="margin: 4px 0;">📧 <a href="mailto:rikon@uaelectronicsindia.com">rikon@uaelectronicsindia.com</a></p>
          <p style="margin: 4px 0;">🌐 <a href="https://uaelectronicsindia.com">uaelectronicsindia.com</a></p>
          <div class="divider"></div>
          <p style="color: #888; margin-top: 10px; font-size: 11px;">
            © 2026 UA Electronics. All rights reserved.<br>
            This is an automated email — please do not reply.<br>
            <a href="mailto:rikon@uaelectronicsindia.com?subject=Unsubscribe" style="color: #C9A227;">Manage Email Preferences</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ============================================
// MAIN sendEmail FUNCTION
// ============================================
async function sendEmail(to, orderData, pdfFilePath = null) {
  try {
    if (!validateEmail(to)) {
      console.error(`❌ Invalid email address: ${to}`);
      return false;
    }

    // Build items HTML
    let itemsHtml = '';
    if (orderData.items && orderData.items.length > 0) {
      orderData.items.forEach((item, index) => {
        const bgColor = index % 2 === 0 ? '#f9f9f9' : '#ffffff';
        itemsHtml += `
          <tr style="background-color: ${bgColor};">
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.name}</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">×${item.qty}</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">₹${(item.price || 0).toLocaleString('en-IN')}</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">₹${(item.subtotal || 0).toLocaleString('en-IN')}</td>
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
      subject: `✅ Order Confirmed - ${orderData.orderId} | UA Electronics`,
      html: buildEmailHTML(orderData, customerName, orderDate, itemsHtml),
      text: `Order Confirmed!\n\nOrder ID: ${orderData.orderId}\nCustomer: ${customerName}\n\nItems:\n${orderData.items?.map(i => `- ${i.name} x${i.qty} = ₹${i.subtotal}`).join('\n') || 'N/A'}\n\nTotal: ₹${(orderData.grand || 0).toLocaleString('en-IN')}\nPayment: ${orderData.paymentMethod === 'online' ? 'Online' : 'Cash on Delivery'}\n\nDelivery Address: ${orderData.customer?.addr1 || 'N/A'}, ${orderData.customer?.city || 'N/A'}\n\nEstimated Delivery: 2-8 Working Days\n\nFor queries: rikon@uaelectronicsindia.com`,
      headers: {
        'Reply-To': GMAIL_USER,
        'X-Priority': '3',
        'X-Mailer': 'UA Electronics Server (Nodemailer)',
        'List-Unsubscribe': `<mailto:rikon@uaelectronicsindia.com?subject=Unsubscribe>`,
      }
    };

    // Attach PDF receipt if provided
    if (pdfFilePath) {
      const fs = require('fs');
      if (fs.existsSync(pdfFilePath)) {
        mailOptions.attachments = [{
          filename: `${orderData.orderId}-receipt.pdf`,
          path: pdfFilePath,
          contentType: 'application/pdf'
        }];
        console.log(`📎 PDF attached: ${pdfFilePath}`);
      } else {
        console.warn(`⚠️  PDF not found at: ${pdfFilePath} — sending without attachment`);
      }
    }

    await sendEmailWithRetry(mailOptions);
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
// QUEUE PROCESSING — retry failed emails every 5 minutes
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
