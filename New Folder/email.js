const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: "rikon@uaelectronicsindia.com",
    pass: "oyuhmygqokqcyegh"
  }
});

async function sendEmail(to, orderData) {
  try {
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
          .shipping-info { background: #fff; padding: 15px; border-radius: 4px; margin-bottom: 15px; }
          .shipping-info h4 { color: #C9A227; margin-top: 0; }
          .shipping-info p { margin: 5px 0; }
          .timeline { background: #fff; padding: 15px; border-radius: 4px; margin-bottom: 20px; border-left: 4px solid #C9A227; }
          .timeline h4 { color: #080808; margin-top: 0; }
          .timeline p { color: #666; margin: 5px 0; }
          .footer { background: #080808; color: #f5f0e8; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px; }
          .footer a { color: #C9A227; text-decoration: none; }
          .footer a:hover { text-decoration: underline; }
          .badge { display: inline-block; background: #C9A227; color: #080808; padding: 5px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-bottom: 10px; }
          .divider { height: 1px; background: #C9A227; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <!-- Header -->
          <div class="header">
            <h1>✅ Order Confirmed</h1>
            <p>Thank you for shopping with UA Electronics!</p>
          </div>

          <!-- Main Content -->
          <div class="content">
            <!-- Order Summary -->
            <div class="order-header">
              <h2 style="margin-bottom: 15px;">Order Summary</h2>
              <div class="order-id">Order ID: ${orderData.orderId}</div>
              <div style="color: #666; font-size: 14px; margin-top: 5px;">Placed on: ${orderDate}</div>
              <div class="badge">Status: ${orderData.status || 'Confirmed'}</div>
            </div>

            <!-- Customer Information -->
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

            <!-- Order Items -->
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
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <!-- Price Breakdown -->
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

            <!-- Payment Details -->
            <div class="section-title">💳 Payment Information</div>
            <div class="customer-info">
              <p><strong>Payment Method:</strong> ${orderData.paymentMethod === 'online' ? '💳 Online (Razorpay)' : '💵 Cash on Delivery (COD)'}</p>
              <p><strong>Payment Status:</strong> ${orderData.paymentStatus || 'N/A'}</p>
            </div>

            <!-- Timeline -->
            <div class="timeline">
              <h4>⏱️ Estimated Delivery Timeline</h4>
              <p>📅 <strong>2-8 Working Days</strong></p>
              <p>Your order will be processed and shipped soon. You'll receive a tracking update via email.</p>
            </div>

            <!-- Additional Info -->
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

          <!-- Footer -->
          <div class="footer">
            <p style="margin-bottom: 10px; font-size: 13px;">
              <strong>Need Help? Contact Us</strong>
            </p>
            <p style="margin: 5px 0;">
              📧 Email: <a href="mailto:support@uaelectronics.in">support@uaelectronics.in</a>
            </p>
            <p style="margin: 5px 0;">
              📞 Phone: <strong>+91-96503-55125-UA-RIKON</strong>
            </p>
            <p style="margin: 5px 0;">
              🌐 Website: <a href="https://uaelectronicsindia.com">uaelectronicsindia.com</a>
            </p>
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

    const info = await transporter.sendMail({
      from: '"UA Electronics" <rikon@uaelectronicsindia.com>',
      to: to,
      subject: `Order Confirmed - ${orderData.orderId} | UA Electronics`,
      html: emailHTML
    });

    console.log("✅ Email sent successfully:", info.response);
    return true;
  } catch (error) {
    console.log("❌ Email Error:", error.message);
    return false;
  }
}

module.exports = sendEmail;