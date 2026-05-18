const nodemailer = require("nodemailer");
require('dotenv').config();

// ✅ FIX 1: Use EMAIL_USER / EMAIL_PASS (matches .env and server.js)
const GMAIL_USER = process.env.EMAIL_USER;
const GMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_SERVICE = (process.env.EMAIL_SERVICE || 'gmail').toLowerCase();
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

// ============================================
// VALIDATION: Check required environment variables
// ============================================
if (!GMAIL_USER || !GMAIL_PASS) {
  console.error("\n❌ CRITICAL ERROR: Email credentials missing!");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("❌ EMAIL_USER (Gmail address) not set");
  console.error("❌ EMAIL_PASS (Gmail App Password) not set");
  console.error("\n🔧 HOW TO FIX:");
  console.error("1. Go to: https://myaccount.google.com/apppasswords");
  console.error("2. Create a new App Password (16 characters)");
  console.error("3. Set in .env or Render environment:");
  console.error("   EMAIL_USER=rikon@uaelectronicsindia.com");
  console.error("   EMAIL_PASS=yhwmxhnmihztnlty");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

let transporter;

if (EMAIL_SERVICE === 'sendgrid' && SENDGRID_API_KEY) {
  console.log("✅ Initializing SendGrid email service...");
  // ✅ FIX 2: pool options must be at the top level, not nested
  transporter = nodemailer.createTransport({
    host: "smtp.sendgrid.net",
    port: 587,
    secure: false,
    auth: {
      user: "apikey",
      pass: SENDGRID_API_KEY
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 4000,
    rateLimit: 14
  });
  console.log("📧 Email service: SendGrid (SMTP)");
} else if (GMAIL_USER && GMAIL_PASS) {
  console.log("✅ Initializing Gmail email service...");
  // ✅ FIX 2: pool options must be at the top level, not nested
  transporter = nodemailer.createTransport({
    host: "smtp-relay.gmail.com", // ✅ Google Workspace SMTP Relay (works on Render)
    port: 587,
    secure: false,
    family: 4, // Force IPv4

    auth: {
      user: GMAIL_USER,
      pass: GMAIL_PASS
    },

    tls: {
      rejectUnauthorized: false
    },

    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,

    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 2000,
    rateLimit: 14,

    debug: process.env.NODE_ENV === 'development',
    logger: process.env.NODE_ENV === 'development'
  });
  console.log("📧 Email service: Google Workspace SMTP Relay (Port 587)");
  console.log("📧 Account: " + GMAIL_USER);
} else {
  console.error("❌ CRITICAL: No valid email service configured!");
  console.error("   Supported: SendGrid (SENDGRID_API_KEY) or Gmail (EMAIL_USER + EMAIL_PASS)");
}

// ============================================
// CONNECTION VERIFICATION
// ============================================
if (transporter) {
  transporter.verify((error, success) => {
    if (error) {
      console.error("\n❌ EMAIL SERVICE VERIFICATION FAILED");
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.error("Error:", error.message);
      console.error("Error Code:", error.code);

      if (error.code === 'EAUTH') {
        console.error("\n🔧 AUTHENTICATION FAILED (EAUTH)");
        console.error("   Possible causes:");
        console.error("   1. EMAIL_PASS is not a Gmail App Password");
        console.error("   2. Wrong email/password combination");
        console.error("   3. 2FA not enabled on Gmail account");
        console.error("\n📖 Solution:");
        console.error("   1. Enable 2-Step Verification: https://myaccount.google.com/security");
        console.error("   2. Create App Password: https://myaccount.google.com/apppasswords");
        console.error("   3. Use the 16-character password in EMAIL_PASS");
      } else if (error.code === 'ENOTFOUND') {
        console.error("\n🔧 NETWORK ERROR (ENOTFOUND)");
        console.error("   Cannot reach Gmail servers");
        console.error("   Check internet connection");
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKET') {
        console.error("\n🔧 CONNECTION TIMEOUT (" + error.code + ")"); // ✅ FIX 3: was broken string literal
        console.error("   Gmail server not responding");
        console.error("   May work after server restart");
      }
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    } else {
      console.log("\n✅ EMAIL SERVICE VERIFIED SUCCESSFULLY!");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("✅ Account: " + GMAIL_USER);
      console.log("✅ Ready to send emails");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    }
  });
} else {
  console.error("\n❌ FATAL: Email transporter could not be initialized");
  console.error("   Check your environment variables\n");
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

async function sendEmailWithRetry(mailOptions, retries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`📤 Sending email (Attempt ${attempt}/${retries})...`);
      console.log(`   To: ${mailOptions.to}`);

      const info = await transporter.sendMail(mailOptions);

      console.log(`✅ Email sent successfully on attempt ${attempt}`);
      console.log(`   Message ID: ${info.messageId}`);
      console.log(`   To: ${mailOptions.to}`);

      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error(`\n❌ Email attempt ${attempt} FAILED`);
      console.error(`   Error: ${error.message}`);
      console.error(`   Code: ${error.code}`);
      console.error(`   To: ${mailOptions.to}`);

      if (attempt < retries) {
        const waitTime = delay * Math.pow(2, attempt - 1);
        console.log(`⏳ Retrying in ${waitTime}ms... (Exponential backoff)`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        console.error("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.error("❌ All email sending attempts FAILED");
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        if (error.code === 'EAUTH') {
          console.error('🔧 AUTHENTICATION ERROR (EAUTH)');
          console.error('   • EMAIL_PASS must be a Gmail App Password (16 chars)');
          console.error('   • Create one: https://myaccount.google.com/apppasswords');
          console.error('   • Must have 2FA enabled first');
        } else if (error.code === 'ENOTFOUND') {
          console.error('🔧 NETWORK ERROR (ENOTFOUND)');
          console.error('   • Cannot reach Gmail servers');
          console.error('   • Check internet connection');
          console.error('   • May be blocked by firewall/ISP');
        } else if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKET') {
          console.error('🔧 CONNECTION TIMEOUT (' + error.code + ')'); // ✅ FIX 3: proper string concat
          console.error('   • Gmail server is slow or not responding');
          console.error('   • Try again in a few moments');
          console.error('   • Consider using SendGrid as alternative');
        } else {
          console.error('🔧 UNKNOWN ERROR');
          console.error('   • Check email credentials');
          console.error('   • Verify Gmail account status');
          console.error('   • Check .env or Render environment variables');
        }
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        throw error;
      }
    }
  }
}

async function sendEmail(to, orderData, pdfFilePath = null) {
  try {
    if (!transporter) {
      console.error("❌ Email transporter not initialized — check EMAIL_USER and EMAIL_PASS in .env");
      return false;
    }

    if (!validateEmail(to)) {
      throw new Error(`Invalid email address: ${to}`);
    }

    // Format items table
    let itemsHtml = '';
    if (orderData.items && orderData.items.length > 0) {
      orderData.items.forEach((item, index) => {
        const bgColor = index % 2 === 0 ? '#f9f9f9' : '#fff';
        itemsHtml += `
          <tr style="background-color: ${bgColor};">
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.name}</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">×${item.qty}</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">₹${item.price.toLocaleString('en-IN')}</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">₹${item.subtotal.toLocaleString('en-IN')}</td>
          </tr>
        `;
      });
    }

    const customerName = orderData.customer?.name || 'Valued Customer';
    const orderDate = new Date(orderData.date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });

    const emailHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
          .header { background: #080808; color: #C9A227; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .header h1 { margin: 0; font-size: 28px; }
          .header p { margin: 5px 0 0 0; color: #f5f0e8; font-size: 14px; }
          .content { padding: 30px; background: #f5f0e8; }
          .order-header { background: #fff; padding: 20px; border-left: 4px solid #C9A227; margin-bottom: 20px; border-radius: 4px; }
          .order-header h2 { color: #C9A227; margin-top: 0; }
          .order-id { font-size: 16px; font-weight: bold; color: #080808; }
          .section-title { color: #080808; font-size: 16px; font-weight: bold; margin-top: 20px; margin-bottom: 10px; border-bottom: 2px solid #C9A227; padding-bottom: 8px; }
          .customer-info { background: #fff; padding: 15px; border-radius: 4px; margin-bottom: 15px; }
          .customer-info p { margin: 5px 0; }
          .customer-info strong { color: #080808; }
          .items-table { width: 100%; border-collapse: collapse; background: #fff; margin-bottom: 20px; border-radius: 4px; overflow: hidden; }
          .items-table th { background: #C9A227; color: #080808; padding: 12px; text-align: left; font-weight: bold; }
          .items-table td { padding: 10px; border-bottom: 1px solid #eee; }
          .items-table th:nth-child(2), .items-table td:nth-child(2) { text-align: center; }
          .items-table th:nth-child(3), .items-table td:nth-child(3),
          .items-table th:nth-child(4), .items-table td:nth-child(4) { text-align: right; }
          .totals { background: #fff; padding: 20px; border-radius: 4px; margin-bottom: 20px; }
          .total-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
          .total-row:last-child { border-bottom: none; }
          .total-label { font-weight: bold; }
          .grand-total { background: #080808; color: #C9A227; padding: 15px; border-radius: 4px; font-size: 18px; font-weight: bold; display: flex; justify-content: space-between; margin-top: 10px; }
          .timeline { background: #fff; padding: 15px; border-radius: 4px; margin-bottom: 20px; border-left: 4px solid #C9A227; }
          .timeline h4 { color: #080808; margin-top: 0; }
          .timeline p { color: #666; margin: 5px 0; }
          .footer { background: #080808; color: #f5f0e8; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px; }
          .footer a { color: #C9A227; text-decoration: none; }
          .badge { display: inline-block; background: #C9A227; color: #080808; padding: 5px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-bottom: 10px; }
          .divider { height: 1px; background: #C9A227; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Order Confirmed</h1>
            <p>Thank you for shopping with UA Electronics!</p>
          </div>
          <div class="content">
            <div class="order-header">
              <h2 style="margin-bottom: 15px;">Order Summary</h2>
              <div class="order-id">Order ID: ${orderData.orderId}</div>
              <div style="color: #666; font-size: 14px; margin-top: 5px;">Placed on: ${orderDate}</div>
              <div class="badge">Status: ${orderData.status || 'Confirmed'}</div>
            </div>
            <div class="section-title">📍 Delivery Information</div>
            <div class="customer-info">
              <p><strong>Name:</strong> ${customerName}</p>
              <p><strong>Email:</strong> ${orderData.customer?.email || 'N/A'}</p>
              <p><strong>Mobile:</strong> ${orderData.customer?.mobile || 'N/A'}</p>
              <p><strong>Address:</strong> ${orderData.customer?.addr1 || ''} ${orderData.customer?.addr2 ? ', ' + orderData.customer.addr2 : ''}</p>
              <p><strong>City:</strong> ${orderData.customer?.city || 'N/A'} - ${orderData.customer?.pin || 'N/A'}</p>
              <p><strong>State:</strong> ${orderData.customer?.state || 'N/A'}</p>
              ${orderData.customer?.notes ? `<p><strong>Special Notes:</strong> ${orderData.customer.notes}</p>` : ''}
            </div>
            <div class="section-title">📦 Order Items</div>
            <table class="items-table">
              <thead>
                <tr>
                  <th style="text-align: left;">Product Name</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>${itemsHtml}</tbody>
            </table>
            <div class="totals">
              <div class="total-row">
                <span class="total-label">Subtotal:</span>
                <span>₹${(orderData.subtotal || 0).toLocaleString('en-IN')}</span>
              </div>
              <div class="total-row">
                <span class="total-label">Delivery Charge:</span>
                <span>₹${(orderData.shipping || 0).toLocaleString('en-IN')}</span>
              </div>
              <div class="grand-total">
                <span>TOTAL AMOUNT:</span>
                <span>₹${(orderData.grand || 0).toLocaleString('en-IN')}</span>
              </div>
            </div>
            <div class="section-title">💳 Payment Information</div>
            <div class="customer-info">
              <p><strong>Payment Method:</strong> ${orderData.paymentMethod === 'online' ? '💳 Online (Razorpay)' : '💵 Cash on Delivery (COD)'}</p>
              <p><strong>Payment Status:</strong> ${orderData.paymentStatus || 'N/A'}</p>
            </div>
            <div class="timeline">
              <h4>⏱️ Estimated Delivery Timeline</h4>
              <p>📅 <strong>2-8 Working Days</strong></p>
              <p>Your order will be processed and shipped soon. You'll receive a tracking update via email.</p>
            </div>
            <div style="background: #fff; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
              <h4 style="color: #080808; margin-top: 0;">✨ Why Choose UA Electronics?</h4>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li>✅ Pan India Delivery</li>
                <li>✅ 1 Year Manufacturer Warranty</li>
                <li>✅ 10-Day Easy Returns</li>
                <li>✅ 24/7 Customer Support</li>
              </ul>
            </div>
          </div>
          <div class="footer">
            <p style="margin-bottom: 10px; font-size: 13px;"><strong>Need Help? Contact Us</strong></p>
            <p style="margin: 5px 0;">📧 Email: <a href="mailto:support@uaelectronics.in">support@uaelectronics.in</a></p>
            <p style="margin: 5px 0;">📞 Phone: <strong>+91-96503-55125-UA-RIKON</strong></p>
            <p style="margin: 5px 0;">🌐 Website: <a href="https://uaelectronicsindia.com">uaelectronicsindia.com</a></p>
            <div class="divider"></div>
            <p style="margin-top: 10px; color: #999;">
              © 2026 UA Electronics. All rights reserved.<br>
              This is an automated email. Please do not reply to this email.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      // ✅ FIX 4: Proper "Name <email>" format for better deliverability
      from: `"UA Electronics" <${GMAIL_USER}>`,
      to: to,
      subject: `Order Confirmed - ${orderData.orderId} | UA Electronics India`,
      html: emailHTML,
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high',
        'X-Mailer': 'UA-Electronics-OrderSystem/1.0',
        'List-Unsubscribe': '<mailto:support@uaelectronics.in?subject=unsubscribe>',
        'Reply-To': 'support@uaelectronics.in'
      },
      text: `Order Confirmed\n\nOrder ID: ${orderData.orderId}\n\nThank you for your order from UA Electronics!\n\nItems:\n${orderData.items?.map(item => `- ${item.name} x${item.qty} = ₹${item.subtotal}`).join('\n') || 'N/A'}\n\nTotal: ₹${(orderData.grand || 0).toLocaleString('en-IN')}\n\nDelivery Address: ${orderData.customer?.addr1 || 'N/A'}, ${orderData.customer?.city || 'N/A'}\n\nFor any queries, contact support@uaelectronics.in`
    };

    // Attach PDF if provided
    if (pdfFilePath) {
      const fsModule = require('fs');
      if (fsModule.existsSync(pdfFilePath)) {
        mailOptions.attachments = [
          {
            filename: `${orderData.orderId}-receipt.pdf`,
            path: pdfFilePath,
            contentType: 'application/pdf'
          }
        ];
        console.log(`📎 PDF attached to email: ${pdfFilePath}`);
      } else {
        console.warn(`⚠️ PDF file not found at: ${pdfFilePath}`);
      }
    }

    const result = await sendEmailWithRetry(mailOptions);
    console.log(`\n✅ ORDER EMAIL SENT SUCCESSFULLY\n   Order: ${orderData.orderId}\n   Recipient: ${to}\n`);
    return result.success;
  } catch (error) {
    console.error(`\n❌ FAILED TO SEND EMAIL FOR ORDER: ${orderData.orderId}`);
    console.error(`   Recipient: ${to}`);
    console.error(`   Error: ${error.message}\n`);
    return false;
  }
}

module.exports = sendEmail;
