/**
 * UA ELECTRONICS - UNIFIED CHECKOUT SYSTEM
 * Fully integrated with main application
 * Handles: Authentication, Cart, Checkout, Payment, Confirmation
 */

// ======================== INITIALIZE CHECKOUT INTEGRATION ========================
document.addEventListener('DOMContentLoaded', function() {
  console.log('✅ Checkout system initialized');
  
  // Setup form handlers
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const checkoutForm = document.getElementById('checkoutForm');
  
  // Handle login form
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = loginForm.querySelector('input[type="email"]').value;
      const password = loginForm.querySelector('input[type="password"]').value;
      
      await handleLogin(email, password);
    });
  }
  
  // Handle register form
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = registerForm.querySelector('input[name="name"]').value;
      const email = registerForm.querySelector('input[type="email"]').value;
      const password = registerForm.querySelector('input[type="password"]').value;
      
      await handleRegister(name, email, password);
    });
  }
  
  // Handle checkout form
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', (e) => {
      e.preventDefault();
      proceedCheckout();
    });
  }
  
  // Setup auth tab switching
  const authTabs = document.querySelectorAll('.auth-tab');
  authTabs.forEach(tab => {
    tab.addEventListener('click', function() {
      const tabName = this.dataset.tab;
      
      // Update active tab
      authTabs.forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      
      // Update active form
      document.querySelectorAll('.auth-form').forEach(f => f.style.display = 'none');
      const form = document.getElementById(tabName + 'Form');
      if (form) form.style.display = 'block';
    });
  });
});

// ======================== AUTHENTICATION ========================

async function handleLogin(email, password) {
  try {
    if (!email || !password) {
      alert('Please enter email and password');
      return;
    }
    
    // Check if admin
    if (email === 'admin@uaelectronics.in' && password === 'admin123') {
      currentUser = { fname: 'Admin', email, phone: '' };
      localStorage.setItem('ua_user', JSON.stringify(currentUser));
      hideModal('loginModal');
      updateAuthUI();
      toast('✅ Admin logged in', 'green');
      return;
    }
    
    // Check user database
    const users = JSON.parse(localStorage.getItem('ua_users') || '[]');
    const user = users.find(u => u.email === email && u.password === password);
    
    if (!user) {
      alert('❌ Invalid email or password');
      return;
    }
    
    currentUser = user;
    localStorage.setItem('ua_user', JSON.stringify(currentUser));
    hideModal('loginModal');
    updateAuthUI();
    toast(`✅ Welcome back, ${currentUser.fname}!`, 'green');
    
  } catch (err) {
    console.error('Login error:', err);
    alert('Login failed: ' + err.message);
  }
}

async function handleRegister(name, email, password) {
  try {
    if (!name || !email || !password) {
      alert('Please fill all fields');
      return;
    }
    
    if (password.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }
    
    if (!/\S+@\S+\.\S+/.test(email)) {
      alert('Invalid email address');
      return;
    }
    
    const users = JSON.parse(localStorage.getItem('ua_users') || '[]');
    
    if (users.find(u => u.email === email)) {
      alert('Email already registered');
      return;
    }
    
    const newUser = { fname: name, email, password, phone: '' };
    users.push(newUser);
    localStorage.setItem('ua_users', JSON.stringify(users));
    
    // Auto-login
    currentUser = newUser;
    localStorage.setItem('ua_user', JSON.stringify(currentUser));
    hideModal('loginModal');
    updateAuthUI();
    toast(`🎉 Welcome to UA Electronics, ${name}!`, 'green');
    
  } catch (err) {
    console.error('Register error:', err);
    alert('Registration failed: ' + err.message);
  }
}

// ======================== CHECKOUT FLOW ========================

function proceedCheckout() {
  try {
    const name = document.getElementById('co_name').value.trim();
    const mobile = document.getElementById('co_mobile').value.trim();
    const email = document.getElementById('co_email').value.trim();
    const addr1 = document.getElementById('co_addr1').value.trim();
    const addr2 = document.getElementById('co_addr2').value.trim();
    const city = document.getElementById('co_city').value.trim();
    const state = document.getElementById('co_state').value;
    const pin = document.getElementById('co_pin').value.trim();
    const notes = document.getElementById('co_notes').value.trim();
    
    // Validation
    if (!name || !mobile || !email || !addr1 || !city || !state || !pin) {
      document.getElementById('coErr1').textContent = '❌ Please fill all required fields';
      return;
    }
    
    // Save delivery info
    pendingOrderInfo = { name, mobile, email, addr1, addr2, city, state, pin, notes };
    localStorage.setItem('ua_checkout_delivery', JSON.stringify(pendingOrderInfo));
    
    // Move to payment step
    document.getElementById('coStep1').style.display = 'none';
    document.getElementById('coStep2').style.display = 'block';
    document.getElementById('step1').className = 'step done';
    document.getElementById('step2').className = 'step active';
    
    // Update payment summary
    updateCheckoutSummary('coSummary2');
    
    window.scrollTo(0, 0);
    
  } catch (err) {
    console.error('Checkout error:', err);
    document.getElementById('coErr1').textContent = '❌ Error: ' + err.message;
  }
}

function backToDelivery() {
  document.getElementById('coStep2').style.display = 'none';
  document.getElementById('coStep1').style.display = 'block';
  document.getElementById('step1').className = 'step active';
  document.getElementById('step2').className = 'step';
  document.getElementById('coErr2').textContent = '';
  window.scrollTo(0, 0);
}

function selectPM(method) {
  selectedPayment = method;
  
  // Hide all payment details
  document.querySelectorAll('.pay-detail').forEach(el => el.style.display = 'none');
  
  // Remove active class from all methods
  document.querySelectorAll('.pay-opt').forEach(el => el.style.opacity = '0.6');
  
  // Show selected payment detail
  const detailEl = document.getElementById('pd-' + method);
  if (detailEl) {
    detailEl.style.display = 'block';
  }
  
  // Highlight selected method
  const methodEl = document.getElementById('pm-' + method);
  if (methodEl) {
    methodEl.style.opacity = '1';
  }
  
  document.getElementById('coErr2').textContent = '';
}

function selUpiApp(el) {
  document.querySelectorAll('.upi-app').forEach(e => e.classList.remove('sel'));
  el.classList.add('sel');
}

function fmtCard(el) {
  let val = el.value.replace(/\s/g, '');
  let formatted = '';
  for (let i = 0; i < val.length; i += 4) {
    if (formatted) formatted += ' ';
    formatted += val.substr(i, 4);
  }
  el.value = formatted;
}

function fmtExp(el) {
  let val = el.value.replace(/\D/g, '');
  if (val.length >= 2) {
    val = val.substr(0, 2) + '/' + val.substr(2, 2);
  }
  el.value = val;
}

function placeOrder() {
  try {
    const err = document.getElementById('coErr2');
    err.textContent = '';
    
    if (!selectedPayment) {
      err.textContent = '❌ Please select a payment method';
      return;
    }
    
    if (!pendingOrderInfo) {
      err.textContent = '❌ Delivery info missing. Go back to Step 1';
      return;
    }
    
    // Validate payment details
    if (selectedPayment === 'card') {
      const num = (document.getElementById('cardNum').value || '').replace(/\s/g, '');
      const exp = document.getElementById('cardExp').value;
      const cvv = document.getElementById('cardCVV').value;
      const cname = document.getElementById('cardName').value.trim();
      
      if (num.length < 16) { err.textContent = '❌ Invalid card number'; return; }
      if (!/^\d{2}\/\d{2}$/.test(exp)) { err.textContent = '❌ Invalid expiry (MM/YY)'; return; }
      if (cvv.length < 3) { err.textContent = '❌ Invalid CVV'; return; }
      if (!cname) { err.textContent = '❌ Enter name on card'; return; }
    }
    
    if (selectedPayment === 'upiid') {
      const uid = (document.getElementById('upiId').value || '').trim();
      if (!uid || !uid.includes('@')) { err.textContent = '❌ Invalid UPI ID'; return; }
    }
    
    if (selectedPayment === 'upiapp') {
      const sel = document.querySelector('.upi-app.sel');
      if (!sel) { err.textContent = '❌ Select a UPI app'; return; }
    }
    
    // Create order
    const totals = getCartTotals ? getCartTotals() : { subtotal: 0, shipping: 0, grand: 0 };
    
    const order = {
      orderId: 'UAE' + Date.now(),
      date: new Date().toISOString(),
      customer: {
        name: pendingOrderInfo.name,
        email: pendingOrderInfo.email,
        mobile: pendingOrderInfo.mobile,
        addr1: pendingOrderInfo.addr1,
        addr2: pendingOrderInfo.addr2,
        city: pendingOrderInfo.city,
        state: pendingOrderInfo.state,
        pin: pendingOrderInfo.pin,
        notes: pendingOrderInfo.notes
      },
      items: cartItems || cart || [],
      subtotal: totals.subtotal || 0,
      shipping: totals.shipping || 0,
      grand: totals.grand || 0,
      paymentMethod: selectedPayment,
      paymentStatus: selectedPayment === 'cod' ? 'COD - Pending' : 'Payment Pending',
      paid: selectedPayment === 'cod' ? false : false,
      status: 'Pending'
    };
    
    // Submit to server
    fetch('http://localhost:3000/save-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    })
    .then(res => {
      if (!res.ok) throw new Error('Server error: ' + res.status);
      return res.json();
    })
    .then(data => {
      if (data.success) {
        console.log('✅ Order saved:', order.orderId);
        
        // Clear cart
        if (window.clearCart) clearCart();
        cartItems = [];
        cart = [];
        localStorage.removeItem('ua_cart');
        
        // Show confirmation
        showConfirmation(order, data.orderId);
      } else {
        err.textContent = '❌ ' + (data.error || 'Order submission failed');
      }
    })
    .catch(error => {
      console.error('Order error:', error);
      err.textContent = '❌ Error: ' + error.message;
    });
    
  } catch (err) {
    console.error('Place order error:', err);
    document.getElementById('coErr2').textContent = '❌ ' + err.message;
  }
}

function showConfirmation(order, orderId) {
  try {
    // Mark steps
    document.getElementById('step2').className = 'step done';
    document.getElementById('step3').className = 'step active';
    
    // Hide payment, show confirmation
    document.getElementById('coStep2').style.display = 'none';
    document.getElementById('coStep3').style.display = 'block';
    
    // Populate confirmation data
    document.getElementById('coConfOrderId').textContent = orderId;
    document.getElementById('coConfEmail').textContent = 'Sent to ' + order.customer.email;
    document.getElementById('coConfAddr').textContent = 
      order.customer.addr1 + ', ' + order.customer.addr2 + ', ' +
      order.customer.city + ' - ' + order.customer.pin + ', ' + order.customer.state;
    document.getElementById('coConfPhone').textContent = order.customer.mobile;
    
    // Items
    const itemsHTML = (order.items || []).map(item => `
      <div style="display:flex;justify-content:space-between;padding:0.75rem 0;border-bottom:1px solid var(--border2)">
        <div>
          <div style="font-weight:600;color:var(--text)">${item.name}</div>
          <div style="font-size:0.8rem;color:var(--text3)">Qty: ${item.qty}</div>
        </div>
        <div style="color:var(--gold2);font-weight:700">₹${(item.price * item.qty).toLocaleString('en-IN')}</div>
      </div>
    `).join('');
    document.getElementById('coConfItems').innerHTML = itemsHTML;
    
    // Totals
    document.getElementById('coConfSubtotal').textContent = '₹' + (order.subtotal || 0).toLocaleString('en-IN');
    document.getElementById('coConfShipping').textContent = order.shipping > 0 ? '₹' + order.shipping.toLocaleString('en-IN') : '✅ Free';
    document.getElementById('coConfTotal').textContent = '₹' + (order.grand || 0).toLocaleString('en-IN');
    
    // Payment status
    const paymentHtml = order.paymentMethod === 'cod'
      ? `<div style="color:#ff6f00;font-weight:600">💵 Amount: <strong>₹${(order.grand || 0).toLocaleString('en-IN')}</strong> to be paid on delivery</div>`
      : `<div style="color:var(--success);font-weight:600">✅ Payment Processed</div>`;
    document.getElementById('coConfPayStatus').innerHTML = paymentHtml;
    
    window.scrollTo(0, 0);
    
    // Auto-redirect after 10 seconds
    setTimeout(() => {
      if (window.showPage) showPage('home');
    }, 10000);
    
  } catch (err) {
    console.error('Confirmation error:', err);
  }
}

function updateCheckoutSummary(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const totals = window.getCartTotals ? getCartTotals() : 
                 (window.cart && window.cart.length ? 
                   {
                     subtotal: (window.cart || []).reduce((s,c) => s + (c.price * c.qty), 0),
                     shipping: 0,
                     grand: (window.cart || []).reduce((s,c) => s + (c.price * c.qty), 0)
                   } : 
                   { subtotal: 0, shipping: 0, grand: 0 });
  
  const items = window.cartItems || window.cart || [];
  
  const itemsHTML = items.length > 0 
    ? items.map(item => `
        <div style="display:flex;justify-content:space-between;padding:0.75rem;background:var(--black3);margin-bottom:0.5rem;border-radius:6px">
          <div>
            <div style="font-weight:600;color:var(--text)">${item.name}</div>
            <div style="font-size:0.8rem;color:var(--text3)">×${item.qty}</div>
          </div>
          <div style="color:var(--gold2);font-weight:700">₹${(item.price * item.qty).toLocaleString('en-IN')}</div>
        </div>
      `).join('')
    : '<div style="color:var(--text3);text-align:center;padding:1rem">🛒 Your cart is empty</div>';
  
  container.innerHTML = `
    ${itemsHTML}
    <div style="border-top:1px solid var(--border2);padding:1rem 0;margin-top:1rem">
      <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem">
        <span style="color:var(--text2)">Subtotal:</span>
        <span style="color:var(--text);font-weight:600">₹${totals.subtotal.toLocaleString('en-IN')}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:1rem">
        <span style="color:var(--text2)">Shipping:</span>
        <span style="color:var(--text);font-weight:600">${totals.shipping > 0 ? '₹' + totals.shipping.toLocaleString('en-IN') : 'FREE'}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:1rem;background:var(--gold-light);border-radius:6px;font-weight:700;color:var(--gold2)">
        <span>TOTAL:</span>
        <span>₹${totals.grand.toLocaleString('en-IN')}</span>
      </div>
    </div>
  `;
}

function goToPayment() {
  proceedCheckout();
}

function copyCheckoutOrderId() {
  const id = document.getElementById('coConfOrderId').textContent;
  navigator.clipboard.writeText(id);
  toast('✅ Order ID Copied!', 'green');
}

// ======================== EXPORT FUNCTIONS ========================
window.checkout = {
  handleLogin,
  handleRegister,
  proceedCheckout,
  selectPM,
  selUpiApp,
  fmtCard,
  fmtExp,
  placeOrder,
  copyCheckoutOrderId,
  goToPayment,
  backToDelivery
};
