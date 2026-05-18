const nodemailer = require("nodemailer");
require('dotenv').config();

const GMAIL_USER = process.env.EMAIL_USER;
const GMAIL_PASS = process.env.EMAIL_PASS;

// ============================================
// VALIDATION: Check required environment variables
// ============================================
if (!GMAIL_USER || !GMAIL_PASS) {
  console.error("\n❌ CRITICAL ERROR: Email credentials missing!");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("  EMAIL_USER not set (e.g. rikon@uaelectronicsindia.com)");
  console.error("  EMAIL_PASS not set (must be a 16-char Google App Password)");
  console.error("\n🔧 HOW TO FIX:");
  console.error("1. Sign in to: https://myaccount.google.com/");
  console.error("   (Use your Google Workspace account: rikon@uaelectronicsindia.com)");
  console.error("2. Go to Security → 2-Step Verification → Enable it");
  console.error("3. Then go to: https://myaccount.google.com/apppasswords");
  console.error("4. App name: 'UA Electronics Server' → Click Create");
  console.error("5. Copy the 16-character password (no spaces)");
  console.error("6. Add to your .env file:");
  console.error("   EMAIL_USER=rikon@uaelectronicsindia.com");
  console.error("   EMAIL_PASS=yhwmxhnmihztnlty   ← your 16-char app password");
  console.error("7. On Render: Add both as Environment Variables in the dashboard");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

// ============================================
// TRANSPORTER SETUP
// ✅ FIX: Use smtp.gmail.com (NOT smtp-relay.gmail.com)
//
// WHY THIS MATTERS:
//   smtp-relay.gmail.com = Google Workspace SMTP Relay
//     → Requires your server's IP to be whitelisted in
//       Google Admin Console → Apps → Gmail → Routing → SMTP relay
//     → IMPOSSIBLE on Render/cloud (dynamic IPs change constantly)
//     → Fails with EAUTH or connection timeout on every deploy
//
//   smtp.gmail.com = Standard Google SMTP (works everywhere)
//     → Authenticates with email + App Password
//     → Works on localhost, Render, Railway, anywhere
//     → No IP whitelisting needed
// ============================================
let transporter = null;

if (GMAIL_USER && GMAIL_PASS) {
  console.log("✅ Initializing Google Workspace SMTP...");
  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",      // ✅ Standard Google SMTP — works on Render & localhost
    port: 587,                   // STARTTLS port
    secure: false,               // false = STARTTLS (upgraded after connect)
    family: 4,                   // Force IPv4 — required for Render

    auth: {
      user: GMAIL_USER,          // rikon@uaelectronicsindia.com
      pass: GMAIL_PASS           // 16-char Google App Password (no spaces)
    },

    tls: {
      rejectUnauthorized: false, // Prevents cert errors on some cloud providers
      minVersion: 'TLSv1.2'
    },

    // Timeouts — generous for cloud environments
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,

    // Connection pool
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    rateDelta: 3000,
    rateLimit: 10,

    debug: process.env.NODE_ENV !== 'production',
    logger: process.env.NODE_ENV !== 'production'
  });

  console.log("📧 Email service: smtp.gmail.com (Port 587 STARTTLS · IPv4)");
  console.log("📧 Account: " + GMAIL_USER);
} else {
  console.error("❌ FATAL: Email transporter could not be initialized — EMAIL_USER or EMAIL_PASS missing.\n");
}

// ============================================
// CONNECTION VERIFICATION (runs on server start)
// ============================================
if (transporter) {
  transporter.verify((error, success) => {
    if (error) {
      console.error("\n❌ EMAIL SERVICE VERIFICATION FAILED");
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.error("Error:", error.message);
      console.error("Code:", error.code);

      if (error.code === 'EAUTH') {
        console.error("\n🔧 AUTHENTICATION FAILED — Most common causes:");
        console.error("   1. EMAIL_PASS is your account password, NOT an App Password");
        console.error("      → Must be 16 characters, no spaces (e.g. yhwmxhnmihztnlty)");
        console.error("   2. 2-Step Verification is NOT enabled on the Google account");
        console.error("      → Enable it first: https://myaccount.google.com/security");
        console.error("   3. App Password was created for wrong account");
        console.error("      → Create it while signed in as rikon@uaelectronicsindia.com");
        console.error("   4. Google Workspace admin has blocked App Passwords");
        console.error("      → Admin must enable: Admin Console → Security → Less secure apps");
        console.error("\n   Fix: https://myaccount.google.com/apppasswords");
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        console.error("\n🔧 NETWORK ERROR — Cannot reach smtp.gmail.com");
        console.error("   Check internet connection / firewall rules");
        console.error("   Port 587 must be open outbound");
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKET') {
        console.error("\n🔧 CONNECTION TIMEOUT — smtp.gmail.com not responding");
        console.error("   Try restarting the server. Usually resolves on retry.");
      }
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    } else {
      console.log("\n✅ EMAIL SERVICE VERIFIED SUCCESSFULLY!");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("✅ Account: " + GMAIL_USER);
      console.log("✅ Ready to send order confirmation emails");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    }
  });
}

// ============================================
// HELPERS
// ============================================
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

async function sendEmailWithRetry(mailOptions, retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`📤 Sending email (Attempt ${attempt}/${retries})...`);
      console.log(`   To: ${mailOptions.to}`);
      console.log(`   Subject: ${mailOptions.subject}`);

      const info = await transporter.sendMail(mailOptions);

      console.log(`✅ Email sent successfully on attempt ${attempt}`);
      console.log(`   Message ID: ${info.messageId}`);
      return { success: true, messageId: info.messageId };

    } catch (error) {
      console.error(`\n❌ Email attempt ${attempt} FAILED`);
      console.error(`   Error: ${error.message}`);
      console.error(`   Code: ${error.code || 'N/A'}`);

      if (attempt < retries) {
        const waitTime = delay * Math.pow(2, attempt - 1); // exponential backoff
        console.log(`⏳ Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        console.error("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.error("❌ All email attempts failed");

        if (error.code === 'EAUTH') {
          console.error("🔧 EAUTH: App Password invalid or 2FA not enabled");
          console.error("   → https://myaccount.google.com/apppasswords");
        } else if (error.code === 'ENOTFOUND') {
          console.error("🔧 ENOTFOUND: Cannot reach smtp.gmail.com");
        } else if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKET') {
          console.error(`🔧 TIMEOUT (${error.code}): Gmail server not responding`);
        }
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        throw error;
      }
    }
  }
}

// ============================================
// MAIN sendEmail FUNCTION
// ============================================
async function sendEmail(to, orderData, pdfFilePath = null) {
  try {
    if (!transporter) {
      console.error("❌ Email transporter not initialized — check EMAIL_USER and EMAIL_PASS");
      return false;
    }

    if (!validateEmail(to)) {
      console.error(`❌ Invalid email address: ${to}`);
      return false;
    }

    // Build items HTML table rows
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

    const emailHTML = `
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
          .total-row:last-child { border-bottom: none; }
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
              This is an automated email — please do not reply.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: `"UA Electronics India" <${GMAIL_USER}>`,
      to: to,
      subject: `✅ Order Confirmed - ${orderData.orderId} | UA Electronics`,
      html: emailHTML,
      text: `Order Confirmed!\n\nOrder ID: ${orderData.orderId}\nCustomer: ${customerName}\n\nItems:\n${orderData.items?.map(i => `- ${i.name} x${i.qty} = ₹${i.subtotal}`).join('\n') || 'N/A'}\n\nTotal: ₹${(orderData.grand || 0).toLocaleString('en-IN')}\nPayment: ${orderData.paymentMethod === 'online' ? 'Online' : 'Cash on Delivery'}\n\nDelivery Address: ${orderData.customer?.addr1 || 'N/A'}, ${orderData.customer?.city || 'N/A'}\n\nEstimated Delivery: 2-8 Working Days\n\nFor queries: rikon@uaelectronicsindia.com`,
      headers: {
        'Reply-To': GMAIL_USER
      }
    };

    // Attach PDF receipt if it exists
    if (pdfFilePath) {
      const fsModule = require('fs');
      if (fsModule.existsSync(pdfFilePath)) {
        mailOptions.attachments = [{
          filename: `${orderData.orderId}-receipt.pdf`,
          path: pdfFilePath,
          contentType: 'application/pdf'
        }];
        console.log(`📎 PDF attached: ${pdfFilePath}`);
      } else {
        console.warn(`⚠️  PDF not found at: ${pdfFilePath} — sending email without attachment`);
      }
    }

    const result = await sendEmailWithRetry(mailOptions);
    console.log(`\n✅ ORDER EMAIL SENT\n   Order: ${orderData.orderId}\n   To: ${to}\n`);
    return result.success;

  } catch (error) {
    console.error(`\n❌ EMAIL FAILED for order: ${orderData.orderId}`);
    console.error(`   To: ${to}`);
    console.error(`   Error: ${error.message}\n`);
    return false;
  }
}

module.exports = sendEmail;
