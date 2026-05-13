/**
 * UA ELECTRONICS - CHECKOUT SYSTEM (SIMPLIFIED & WORKING)
 * Minimal but complete implementation that works with existing HTML
 */

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCheckout);
} else {
  initCheckout();
}

function initCheckout() {
  console.log('✅ Checkout system loaded');
  
  // Bind checkout form
  const checkoutForm = document.getElementById('checkoutForm');
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitCheckout();
    });
  }
  
  // Bind auth forms
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await submitLogin(loginForm);
    });
  }
  
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await submitRegister(registerForm);
    });
  }
  
  // Bind auth tab switching
  const authTabs = document.querySelectorAll('.auth-tab');
  authTabs.forEach(tab => {
    tab.addEventListener('click', function() {
      const tabName = this.dataset.tab;
      
      // Update tabs
      authTabs.forEach(t => {
        t.classList.toggle('active', t === this);
        t.style.background = t === this ? 'var(--gold)' : 'transparent';
        t.style.color = t === this ? 'var(--black)' : 'var(--gold)';
      });
      
      // Update forms
      document.querySelectorAll('.auth-form').forEach(f => {
        f.style.display = 'none';
      });
      
      const form = document.getElementById(tabName + 'Form');
      if (form) form.style.display = 'block';
    });
  });
}

// ======================== AUTHENTICATION ========================

async function submitLogin(form) {
  try {
    const email = form.querySelector('input[type="email"]').value.trim();
    const password = form.querySelector('input[type="password"]').value;
    
    if (!email || !password) {
      alert('❌ Please fill all fields');
      return;
    }
    
    // Check admin
    if (email === 'admin@uaelectronics.in' && password === 'admin123') {
      window.currentUser = { fname: 'Admin', email };
      localStorage.setItem('ua_user', JSON.stringify(window.currentUser));
      hideModal('loginModal');
      if (typeof updateAuthUI === 'function') updateAuthUI();
      if (typeof toast === 'function') toast('✅ Admin logged in', 'green');
      return;
    }
    
    // Check user database
    const users = JSON.parse(localStorage.getItem('ua_users') || '[]');
    const user = users.find(u => u.email === email && u.password === password);
    
    if (!user) {
      alert('❌ Invalid email or password');
      return;
    }
    
    window.currentUser = user;
    localStorage.setItem('ua_user', JSON.stringify(user));
    form.reset();
    hideModal('loginModal');
    if (typeof updateAuthUI === 'function') updateAuthUI();
    if (typeof toast === 'function') toast(`✅ Welcome back, ${user.fname}!`, 'green');
    
  } catch (err) {
    console.error('Login error:', err);
    alert('❌ Login failed: ' + err.message);
  }
}

async function submitRegister(form) {
  try {
    const name = form.querySelector('input[name="name"]').value.trim();
    const email = form.querySelector('input[type="email"]').value.trim();
    const password = form.querySelector('input[type="password"]').value;
    
    if (!name || !email || !password) {
      alert('❌ Please fill all fields');
      return;
    }
    
    if (password.length < 6) {
      alert('❌ Password must be at least 6 characters');
      return;
    }
    
    if (!/\S+@\S+\.\S+/.test(email)) {
      alert('❌ Invalid email');
      return;
    }
    
    // Check if email exists
    const users = JSON.parse(localStorage.getItem('ua_users') || '[]');
    if (users.find(u => u.email === email)) {
      alert('❌ This email is already registered');
      return;
    }
    
    // Create user
    const newUser = { fname: name, email, password };
    users.push(newUser);
    localStorage.setItem('ua_users', JSON.stringify(users));
    
    // Auto-login
    window.currentUser = newUser;
    localStorage.setItem('ua_user', JSON.stringify(newUser));
    form.reset();
    hideModal('loginModal');
    if (typeof updateAuthUI === 'function') updateAuthUI();
    if (typeof toast === 'function') toast(`🎉 Welcome to UA Electronics, ${name}!`, 'green');
    
  } catch (err) {
    console.error('Register error:', err);
    alert('❌ Registration failed: ' + err.message);
  }
}

// ======================== CHECKOUT ========================

function submitCheckout() {
  try {
    // Get form values
    const name = document.querySelector('input[name="name"]').value.trim();
    const mobile = document.querySelector('input[name="mobile"]').value.trim();
    const email = document.querySelector('input[name="email"]').value.trim();
    const addr1 = document.querySelector('input[name="addr1"]').value.trim();
    const addr2 = document.querySelector('input[name="addr2"]').value.trim();
    const city = document.querySelector('input[name="city"]').value.trim();
    const pin = document.querySelector('input[name="pin"]').value.trim();
    const state = document.querySelector('input[name="state"]').value.trim();
    const notes = document.querySelector('textarea[name="notes"]').value.trim();
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
    
    // Validate
    if (!name || !mobile || !email || !addr1 || !city || !pin || !state) {
      alert('❌ Please fill all required fields');
      return;
    }
    
    // Check mobile format
    if (!/^\d{10}$/.test(mobile.replace(/\D/g, ''))) {
      alert('❌ Invalid mobile number (10 digits required)');
      return;
    }
    
    // Get cart items
    const cartItems = window.cartItems || JSON.parse(localStorage.getItem('ua_cart') || '[]');
    
    if (cartItems.length === 0) {
      alert('❌ Your cart is empty');
      return;
    }
    
    // Calculate totals
    let subtotal = 0;
    cartItems.forEach(item => {
      subtotal += (item.price || 0) * (item.qty || 1);
    });
    const shipping = subtotal >= 999 ? 0 : 99;
    const grand = subtotal + shipping;
    
    // Create order
    const order = {
      orderId: 'UAE' + Date.now(),
      date: new Date().toISOString(),
      customer: { name, mobile, email, addr1, addr2, city, pin, state, notes },
      items: cartItems,
      subtotal: subtotal,
      shipping: shipping,
      grand: grand,
      paymentMethod: paymentMethod,
      paymentStatus: 'Pending',
      status: 'Pending'
    };
    
    console.log('📤 Placing order:', order.orderId);
    
    // Submit to server
    fetch('http://localhost:3000/save-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        console.log('✅ Order saved successfully');
        
        // Clear cart
        window.cartItems = [];
        localStorage.removeItem('ua_cart');
        if (typeof updateCartUI === 'function') updateCartUI();
        
        // Show confirmation
        hideModal('checkoutModal');
        showOrderConfirmation(order, data.orderId);
        
        // Clear form
        document.getElementById('checkoutForm').reset();
        
      } else {
        alert('❌ Order submission failed: ' + (data.error || 'Unknown error'));
      }
    })
    .catch(err => {
      console.error('Order error:', err);
      alert('❌ Error: ' + err.message);
    });
    
  } catch (err) {
    console.error('Checkout error:', err);
    alert('❌ ' + err.message);
  }
}

function showOrderConfirmation(order, orderId) {
  try {
    const modal = document.getElementById('confirmationModal');
    if (!modal) {
      alert('✅ Order Placed Successfully!\n\nOrder ID: ' + orderId + '\n\nCheck your email for confirmation.');
      return;
    }
    
    // Generate confirmation HTML
    const itemsHtml = (order.items || []).map(item => `
      <tr style="border-bottom:1px solid var(--border2)">
        <td style="padding:0.75rem;color:var(--text)">${item.name}</td>
        <td style="padding:0.75rem;text-align:center;color:var(--text2)">×${item.qty}</td>
        <td style="padding:0.75rem;text-align:right;color:var(--gold2);font-weight:700">₹${((item.price || 0) * (item.qty || 1)).toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
    
    const html = `
      <div style="padding:1.5rem">
        <div class="modal-x" onclick="hideModal('confirmationModal')">✕</div>
        <div style="text-align:center;margin-bottom:1.5rem">
          <div style="font-size:3rem;margin-bottom:0.5rem">✅</div>
          <div style="font-size:1.5rem;font-weight:700;color:var(--gold2);margin-bottom:0.5rem">Order Confirmed!</div>
          <div style="color:var(--text2);margin-bottom:1rem">Your order has been placed successfully</div>
          <div style="background:var(--black3);padding:0.75rem 1rem;border-radius:6px;font-family:monospace;color:var(--gold2);font-weight:700;font-size:1.1rem">
            ${orderId}
            <button onclick="copyConfirmationId('${orderId}')" style="margin-left:0.5rem;padding:0.25rem 0.5rem;background:var(--gold);color:var(--black);border:none;border-radius:3px;cursor:pointer;font-size:0.8rem;font-family:inherit">📋 COPY</button>
          </div>
        </div>
        
        <div style="border:1px solid var(--border2);border-radius:6px;padding:1rem;margin-bottom:1rem">
          <div style="font-weight:700;color:var(--text);margin-bottom:0.75rem;font-size:0.9rem;text-transform:uppercase">Delivery Address</div>
          <div style="color:var(--text2);line-height:1.6">
            ${order.customer.name}<br>
            ${order.customer.addr1}${order.customer.addr2 ? ', ' + order.customer.addr2 : ''}<br>
            ${order.customer.city} - ${order.customer.pin}<br>
            ${order.customer.state}<br>
            <strong>Mobile:</strong> ${order.customer.mobile}
          </div>
        </div>
        
        <div style="border:1px solid var(--border2);border-radius:6px;padding:1rem;margin-bottom:1rem;overflow-x:auto">
          <div style="font-weight:700;color:var(--text);margin-bottom:0.75rem;font-size:0.9rem;text-transform:uppercase">Order Items</div>
          <table style="width:100%;font-size:0.9rem">
            <thead>
              <tr style="border-bottom:2px solid var(--border2)">
                <th style="text-align:left;padding:0.75rem;color:var(--text2)">Product</th>
                <th style="text-align:center;padding:0.75rem;color:var(--text2)">Qty</th>
                <th style="text-align:right;padding:0.75rem;color:var(--text2)">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
              <tr>
                <td colspan="2" style="padding:0.75rem;text-align:right;font-weight:600;color:var(--text)">Subtotal</td>
                <td style="padding:0.75rem;text-align:right;color:var(--text);font-weight:600">₹${(order.subtotal || 0).toLocaleString('en-IN')}</td>
              </tr>
              <tr>
                <td colspan="2" style="padding:0.75rem;text-align:right;font-weight:600;color:var(--text)">Shipping</td>
                <td style="padding:0.75rem;text-align:right;color:var(--text);font-weight:600">${order.shipping > 0 ? '₹' + order.shipping.toLocaleString('en-IN') : '✅ FREE'}</td>
              </tr>
              <tr style="background:var(--gold-light)">
                <td colspan="2" style="padding:0.75rem;text-align:right;font-weight:700;color:var(--gold2)">TOTAL</td>
                <td style="padding:0.75rem;text-align:right;font-weight:700;color:var(--gold2);font-size:1.1rem">₹${(order.grand || 0).toLocaleString('en-IN')}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div style="background:var(--black3);border-left:3px solid var(--gold);padding:1rem;border-radius:6px;margin-bottom:1rem">
          <div style="font-weight:700;color:var(--text);margin-bottom:0.5rem">📧 Confirmation Email</div>
          <div style="color:var(--text2);font-size:0.9rem">A detailed order confirmation has been sent to <strong>${order.customer.email}</strong></div>
        </div>
        
        <div style="background:var(--black3);padding:1rem;border-radius:6px;margin-bottom:1rem">
          <div style="font-weight:700;color:var(--text);margin-bottom:0.5rem">📦 Next Steps</div>
          <div style="color:var(--text2);font-size:0.9rem;line-height:1.6">
            • We'll process your order shortly<br>
            • Delivery expected in 2-8 business days<br>
            • Track your order using the Order ID<br>
            • You'll receive SMS/Email updates
          </div>
        </div>
        
        <button onclick="hideModal('confirmationModal'); location.href='/';" style="width:100%;padding:0.75rem;background:var(--gold);color:var(--black);border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:1rem">Continue Shopping</button>
      </div>
    `;
    
    modal.innerHTML = html;
    showModal('confirmationModal');
    
  } catch (err) {
    console.error('Confirmation error:', err);
    alert('✅ Order Placed!\n\nOrder ID: ' + orderId);
  }
}

function copyConfirmationId(id) {
  navigator.clipboard.writeText(id);
  if (typeof toast === 'function') {
    toast('✅ Order ID copied!', 'green');
  }
}
