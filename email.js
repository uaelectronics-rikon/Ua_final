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

      // Build MIME message
      let mimeMessage = `From: ${mailOptions.from}\r\n`;
      mimeMessage += `To: ${mailOptions.to}\r\n`;
mimeMessage += `Subject: =?UTF-8?B?${Buffer.from(mailOptions.subject).toString('base64')}?=\r\n`;
      mimeMessage += `Content-Type: text/html; charset="UTF-8"\r\n`;
      mimeMessage += `MIME-Version: 1.0\r\n`;
      mimeMessage += `Reply-To: ${GMAIL_USER}\r\n`;
      mimeMessage += `X-Priority: 3\r\n`;
      mimeMessage += `X-Mailer: UA Electronics Server (Gmail API)\r\n`;
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
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
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