/**
 * UA ELECTRONICS - CHECKOUT SYSTEM
 * Handles complete checkout flow: auth, cart, payment, order submission
 */

// ======================== GLOBAL STATE ========================
let currentUser = null;
let cartItems = [];
const API_BASE = "http://localhost:3000";

// Load saved state on page load
if (typeof window !== "undefined") {
  currentUser = JSON.parse(localStorage.getItem("currentUser")) || null;
  cartItems = JSON.parse(localStorage.getItem("cartItems")) || [];
  
  // Update UI if user is logged in
  if (currentUser) {
    updateUserUI();
  }
}

// ======================== AUTHENTICATION ========================
/**
 * Register a new user
 */
async function registerUser(email, password, name) {
  try {
    const response = await fetch(`${API_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Registration failed");
    }

    // Auto-login after registration
    const loginRes = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const loginData = await loginRes.json();

    if (loginRes.ok && loginData.success) {
      currentUser = {
        userId: loginData.userId,
        name: loginData.name,
        email: loginData.email
      };
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      updateUserUI();
      return { success: true, message: "Account created and logged in!" };
    }

    return { success: true, message: data.message };
  } catch (error) {
    console.error("Register error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Login user
 */
async function loginUser(email, password) {
  try {
    const response = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Login failed");
    }

    currentUser = {
      userId: data.userId,
      name: data.name,
      email: data.email
    };

    localStorage.setItem("currentUser", JSON.stringify(currentUser));
    updateUserUI();
    
    return { success: true, message: "Logged in successfully!" };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Logout user
 */
function logoutUser() {
  currentUser = null;
  localStorage.removeItem("currentUser");
  updateUserUI();
  cartItems = [];
  localStorage.removeItem("cartItems");
}

/**
 * Update UI based on user state
 */
function updateUserUI() {
  const authBtn = document.querySelector(".btn-outline");
  const userMenu = document.querySelector(".user-menu");
  
  if (currentUser && authBtn) {
    authBtn.textContent = currentUser.name;
    authBtn.className = "btn-gold";
    if (userMenu) {
      userMenu.style.display = "flex";
    }
  } else if (authBtn) {
    authBtn.textContent = "LOGIN";
    authBtn.className = "btn-outline";
    if (userMenu) {
      userMenu.style.display = "none";
    }
  }
}

// ======================== CART MANAGEMENT ========================
/**
 * Add product to cart
 */
function addToCart(product) {
  if (!currentUser) {
    showModal("loginModal");
    return false;
  }

  const existingItem = cartItems.find(item => item.id === product.id);

  if (existingItem) {
    existingItem.qty += 1;
    existingItem.subtotal = existingItem.price * existingItem.qty;
  } else {
    cartItems.push({
      id: product.id,
      name: product.name,
      brand: product.brand,
      icon: product.icon,
      price: product.price,
      qty: 1,
      subtotal: product.price
    });
  }

  saveCart();
  updateCartUI();
  return true;
}

/**
 * Update cart item quantity
 */
function updateCartQty(productId, qty) {
  const item = cartItems.find(item => item.id == productId);
  if (item) {
    item.qty = parseInt(qty) || 1;
    item.subtotal = item.price * item.qty;
    saveCart();
    updateCartUI();
  }
}

/**
 * Remove item from cart
 */
function removeFromCart(productId) {
  cartItems = cartItems.filter(item => item.id !== productId);
  saveCart();
  updateCartUI();
}

/**
 * Clear entire cart
 */
function clearCart() {
  cartItems = [];
  saveCart();
  updateCartUI();
}

/**
 * Save cart to localStorage
 */
function saveCart() {
  localStorage.setItem("cartItems", JSON.stringify(cartItems));
}

/**
 * Get cart totals
 */
function getCartTotals() {
  const subtotal = cartItems.reduce((sum, item) => sum + item.subtotal, 0);
  const shipping = subtotal > 0 && subtotal < 999 ? 0 : 0; // Free shipping
  const grand = subtotal + shipping;
  const savings = cartItems.reduce((sum, item) => {
    return sum + (item.mrp ? (item.mrp - item.price) * item.qty : 0);
  }, 0);

  return { subtotal, shipping, grand, savings };
}

/**
 * Update cart UI elements
 */
function updateCartUI() {
  const cartCount = document.querySelector(".cart-count");
  const cartBody = document.querySelector(".cart-body");
  const checkoutBtn = document.querySelector(".checkout-b");
  const totals = getCartTotals();

  // Update cart count
  if (cartCount) {
    cartCount.textContent = cartItems.length;
    cartCount.style.display = cartItems.length > 0 ? "flex" : "none";
  }

  // Update cart body
  if (cartBody) {
    if (cartItems.length === 0) {
      cartBody.innerHTML = `
        <div class="cart-empty">
          <div class="ei">🛒</div>
          <p>Your cart is empty</p>
        </div>
      `;
    } else {
      cartBody.innerHTML = cartItems.map(item => `
        <div class="c-item" data-id="${item.id}">
          <div class="c-item-img">${item.icon}</div>
          <div class="c-item-info">
            <div class="c-item-brand">${item.brand}</div>
            <div class="c-item-name">${item.name}</div>
            <div class="c-item-price">₹${item.price.toLocaleString("en-IN")}</div>
            <div class="qty-row">
              <button class="q-btn" onclick="updateCartQty(${item.id}, ${item.qty - 1})">−</button>
              <input type="number" class="q-input" value="${item.qty}" onchange="updateCartQty(${item.id}, this.value)" min="1">
              <button class="q-btn" onclick="updateCartQty(${item.id}, ${item.qty + 1})">+</button>
            </div>
          </div>
          <button class="c-rm" onclick="removeFromCart(${item.id})">✕</button>
        </div>
      `).join("");
    }
  }

  // Update footer totals
  const totalRow = document.querySelector(".cart-total-row");
  if (totalRow && cartItems.length > 0) {
    const html = `
      <span>Subtotal: ₹${totals.subtotal.toLocaleString("en-IN")}</span>
      <span>Shipping: ${totals.shipping === 0 ? "FREE" : "₹" + totals.shipping.toLocaleString("en-IN")}</span>
      <div style="border-top: 1px solid var(--border2); width: 100%; margin: 0.5rem 0;"></div>
      <span>TOTAL: ₹${totals.grand.toLocaleString("en-IN")}</span>
    `;
    const container = totalRow.parentElement;
    if (container) {
      container.innerHTML = html;
    }
  }
}

// ======================== CHECKOUT PROCESS ========================
/**
 * Proceed to checkout
 */
function proceedToCheckout() {
  if (!currentUser) {
    showModal("loginModal");
    return;
  }

  if (cartItems.length === 0) {
    alert("Please add items to cart first!");
    return;
  }

  // Show checkout modal
  showModal("checkoutModal");
}

/**
 * Submit checkout form
 */
async function submitCheckoutForm() {
  // Get form data
  const form = document.querySelector("#checkoutForm");
  if (!form) {
    console.error("Checkout form not found");
    return;
  }

  const formData = new FormData(form);
  const customer = {
    name: formData.get("name"),
    mobile: formData.get("mobile"),
    email: formData.get("email"),
    addr1: formData.get("addr1"),
    addr2: formData.get("addr2"),
    city: formData.get("city"),
    state: formData.get("state"),
    pin: formData.get("pin"),
    notes: formData.get("notes")
  };

  // Validate
  if (!customer.name || !customer.mobile || !customer.email || !customer.addr1 || !customer.city || !customer.state || !customer.pin) {
    alert("Please fill all required fields!");
    return;
  }

  // Get payment method
  const paymentMethod = document.querySelector("input[name='paymentMethod']:checked");
  if (!paymentMethod) {
    alert("Please select a payment method!");
    return;
  }

  const selectedPayment = paymentMethod.value;
  const totals = getCartTotals();

  // Create order object
  const order = {
    orderId: "UAE" + Date.now(),
    date: new Date().toISOString(),
    customer: customer,
    items: cartItems,
    subtotal: totals.subtotal,
    shipping: totals.shipping,
    grand: totals.grand,
    paymentMethod: selectedPayment,
    paymentStatus: selectedPayment === "online" ? "Pending" : "COD - Pending",
    paid: false,
    status: "Pending"
  };

  // Close checkout modal
  hideModal("checkoutModal");

  // Process based on payment method
  if (selectedPayment === "online") {
    await processOnlinePayment(order);
  } else {
    await submitOrder(order);
  }
}

/**
 * Process online payment via Razorpay
 */
async function processOnlinePayment(order) {
  try {
    // Create Razorpay order
    const response = await fetch(`${API_BASE}/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: order.grand,
        currency: "INR",
        orderId: order.orderId
      })
    });

    const razorpayOrder = await response.json();

    if (!razorpayOrder.id) {
      throw new Error("Failed to create payment order");
    }

    // Initialize Razorpay checkout
    const options = {
      key: "rzp_test_xxxxxxxx", // Replace with your key
      amount: order.grand * 100,
      currency: "INR",
      name: "UA Electronics",
      description: `Order ${order.orderId}`,
      order_id: razorpayOrder.id,
      handler: async function (response) {
        // Payment successful
        order.paymentStatus = "Paid";
        order.paid = true;
        order.status = "Confirmed";
        order.razorpayPaymentId = response.razorpay_payment_id;

        await submitOrder(order);
      },
      prefill: {
        name: order.customer.name,
        email: order.customer.email,
        contact: order.customer.mobile
      },
      theme: {
        color: "#C9A227"
      }
    };

    // Load Razorpay script if not loaded
    if (!window.Razorpay) {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => {
        new window.Razorpay(options).open();
      };
      document.body.appendChild(script);
    } else {
      new window.Razorpay(options).open();
    }
  } catch (error) {
    console.error("Payment error:", error);
    alert("Payment failed: " + error.message);
  }
}

/**
 * Submit order to backend
 */
async function submitOrder(order) {
  try {
    console.log("📤 Submitting order:", order);

    const response = await fetch(`${API_BASE}/save-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order)
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Order submission failed");
    }

    console.log("✅ Order submitted successfully:", data.orderId);

    // Clear cart
    clearCart();

    // Show order confirmation
    showOrderConfirmation(order, data.orderId);

  } catch (error) {
    console.error("Order submission error:", error);
    alert("❌ Failed to place order: " + error.message);
  }
}

/**
 * Show order confirmation
 */
function showOrderConfirmation(order, orderId) {
  const modal = document.getElementById("confirmationModal");
  if (!modal) {
    console.error("Confirmation modal not found");
    return;
  }

  // Calculate delivery date (5-7 business days from now)
  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + 6); // Default to 6 days (5-7 range)
  const deliveryDateStr = deliveryDate.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Build product items HTML
  const itemsHTML = order.items.map(item => `
    <tr style="border-bottom: 1px solid var(--border2);">
      <td style="padding: 12px 8px; font-weight: 600; color: var(--text);">${item.name}</td>
      <td style="padding: 12px 8px; text-align: center; color: var(--text);">×${item.qty}</td>
      <td style="padding: 12px 8px; text-align: right; color: var(--gold2); font-weight: 700;">₹${(item.price * item.qty).toLocaleString('en-IN')}</td>
    </tr>
  `).join('');

  // Update modal content with comprehensive order details
  const content = modal.querySelector(".modal-content") || modal;
  content.innerHTML = `
    <div class="modal-x" onclick="redirectToHome()" style="position: absolute; top: 12px; right: 12px; z-index: 10;">✕</div>
    
    <div style="padding: 2rem; background: var(--black);">
      <!-- Step 3 Header -->
      <div style="text-align: center; padding: 1rem 0; margin-bottom: 1.5rem; border-bottom: 2px solid var(--border2);">
        <p style="color: var(--gold); font-size: 0.8rem; letter-spacing: 3px; font-weight: 700; margin-bottom: 0.5rem;">STEP 3 OF 3</p>
        <h2 style="color: var(--gold2); margin-bottom: 0.5rem; font-size: 1.8rem; font-weight: 900;">ORDER CONFIRMATION</h2>
      </div>

      <!-- Success Header -->
      <div style="text-align: center; padding: 1.5rem 0; border-bottom: 2px solid var(--border2); margin-bottom: 2rem;">
        <div style="font-size: 3.5rem; margin-bottom: 1rem; animation: pulse 0.6s ease;">✅</div>
        <h2 style="color: var(--gold2); margin-bottom: 0.5rem; font-size: 1.8rem; font-weight: 900;">ORDER CONFIRMED!</h2>
        <p style="color: var(--text2); font-size: 0.95rem;">Your order has been placed successfully</p>
      </div>

      <!-- Order ID Section -->
      <div style="background: var(--card); padding: 1rem; border-radius: 8px; border-left: 4px solid var(--gold); margin-bottom: 1.5rem;">
        <p style="color: var(--text3); font-size: 0.8rem; letter-spacing: 2px; margin-bottom: 0.3rem;">ORDER ID</p>
        <p style="color: var(--gold2); font-weight: 900; font-size: 1.3rem; font-family: monospace;">${orderId}</p>
        <p style="color: var(--text3); font-size: 0.85rem; margin-top: 0.5rem;">📅 ${new Date(order.date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      <!-- Delivery Info -->
      <div style="background: linear-gradient(135deg, rgba(184,146,31,0.1), transparent); padding: 1rem; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 1.5rem;">
        <h3 style="color: var(--gold2); font-size: 0.95rem; font-weight: 700; margin-bottom: 0.8rem; letter-spacing: 1px;">🚚 EXPECTED DELIVERY</h3>
        <p style="color: var(--text); font-size: 1rem; font-weight: 600; margin-bottom: 0.3rem;">${deliveryDateStr}</p>
        <p style="color: var(--text2); font-size: 0.85rem;">Estimated 5-7 business days from order date</p>
        <p style="color: var(--text3); font-size: 0.8rem; margin-top: 0.5rem;">Free standard delivery on all orders above ₹999</p>
      </div>

      <!-- Customer Details -->
      <div style="margin-bottom: 1.5rem;">
        <h3 style="color: var(--gold); font-size: 1rem; font-weight: 700; margin-bottom: 1rem; letter-spacing: 1px;">👤 DELIVERY ADDRESS</h3>
        <div style="background: var(--card); padding: 1rem; border-radius: 8px; border: 1px solid var(--border2);">
          <p style="color: var(--text); font-weight: 600; margin-bottom: 0.3rem;">${order.customer.name}</p>
          <p style="color: var(--text2); font-size: 0.9rem; margin-bottom: 0.5rem; line-height: 1.5;">
            ${order.customer.addr1}<br>
            ${order.customer.addr2 ? order.customer.addr2 + '<br>' : ''}
            ${order.customer.city}, ${order.customer.state} - ${order.customer.pin}<br>
            <span style="color: var(--text3);">📱 ${order.customer.mobile}</span>
          </p>
          <p style="color: var(--text3); font-size: 0.85rem; margin-top: 0.5rem;">📧 ${order.customer.email}</p>
        </div>
      </div>

      <!-- Order Items -->
      <div style="margin-bottom: 1.5rem;">
        <h3 style="color: var(--gold); font-size: 1rem; font-weight: 700; margin-bottom: 1rem; letter-spacing: 1px;">📦 ORDER ITEMS</h3>
        <div style="background: var(--card); border-radius: 8px; overflow: hidden; border: 1px solid var(--border2);">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: var(--card2); border-bottom: 2px solid var(--border);">
                <th style="padding: 12px 8px; text-align: left; color: var(--text2); font-weight: 600; font-size: 0.85rem;">PRODUCT</th>
                <th style="padding: 12px 8px; text-align: center; color: var(--text2); font-weight: 600; font-size: 0.85rem;">QTY</th>
                <th style="padding: 12px 8px; text-align: right; color: var(--text2); font-weight: 600; font-size: 0.85rem;">PRICE</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHTML}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Price Breakdown -->
      <div style="background: var(--card); padding: 1.2rem; border-radius: 8px; border: 1px solid var(--border2); margin-bottom: 1.5rem;">
        <h3 style="color: var(--gold); font-size: 1rem; font-weight: 700; margin-bottom: 1rem; letter-spacing: 1px;">💰 PRICE DETAILS</h3>
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.7rem 0; border-bottom: 1px solid var(--border2);">
          <span style="color: var(--text2);">Subtotal</span>
          <span style="color: var(--text); font-weight: 600;">₹${order.subtotal.toLocaleString('en-IN')}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.7rem 0; border-bottom: 1px solid var(--border2);">
          <span style="color: var(--text2);">Delivery Charges</span>
          <span style="color: ${order.shipping === 0 ? 'var(--success)' : 'var(--text)'}; font-weight: 600;">${order.shipping === 0 ? '✅ Free' : '₹' + order.shipping.toLocaleString('en-IN')}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 0; border-top: 2px solid var(--gold); background: rgba(184,146,31,0.05); padding: 1rem; margin-top: 0.5rem; border-radius: 6px;">
          <span style="color: var(--gold2); font-weight: 700; font-size: 1.05rem;">TOTAL AMOUNT</span>
          <span style="color: var(--gold2); font-weight: 900; font-size: 1.4rem;">₹${order.grand.toLocaleString('en-IN')}</span>
        </div>
      </div>

      <!-- Payment & Status Info -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
        <div style="background: var(--card); padding: 1rem; border-radius: 8px; border: 1px solid var(--border2);">
          <p style="color: var(--text3); font-size: 0.8rem; letter-spacing: 1px; margin-bottom: 0.3rem;">PAYMENT METHOD</p>
          <p style="color: var(--text); font-weight: 700; font-size: 1rem;">${order.paymentMethod === 'online' ? '💳 Online Payment' : '💵 Cash on Delivery'}</p>
          <p style="color: var(--text2); font-size: 0.85rem; margin-top: 0.3rem;">${order.paymentStatus}</p>
        </div>
        <div style="background: var(--card); padding: 1rem; border-radius: 8px; border: 1px solid var(--border2);">
          <p style="color: var(--text3); font-size: 0.8rem; letter-spacing: 1px; margin-bottom: 0.3rem;">ORDER STATUS</p>
          <p style="color: var(--gold2); font-weight: 700; font-size: 1rem;">🟡 ${order.status}</p>
          <p style="color: var(--text2); font-size: 0.85rem; margin-top: 0.3rem;">Being processed</p>
        </div>
      </div>

      <!-- Confirmation Email Notice -->
      <div style="background: rgba(76,175,80,0.1); border: 1px solid rgba(76,175,80,0.3); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;">
        <p style="color: var(--success); font-size: 0.9rem;">✅ A confirmation email has been sent to <strong>${order.customer.email}</strong></p>
        <p style="color: var(--text2); font-size: 0.8rem; margin-top: 0.5rem;">You can track your order from your account dashboard</p>
      </div>

      <!-- Auto-Redirect Timer -->
      <div style="background: linear-gradient(135deg, rgba(30,144,255,0.1), rgba(30,144,255,0.05)); border: 1.5px solid rgba(30,144,255,0.3); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; text-align: center;">
        <p style="color: var(--text2); font-size: 0.8rem; margin-bottom: 0.5rem;">REDIRECTING TO HOME IN</p>
        <p id="redirectCountdown" style="color: #1E90FF; font-weight: 900; font-size: 1.8rem; letter-spacing: 2px;">02:00</p>
        <p style="color: var(--text3); font-size: 0.75rem; margin-top: 0.5rem;">Or press the button below to go now</p>
      </div>

      <!-- Action Buttons -->
      <div style="display: flex; gap: 1rem; justify-content: center;">
        <button onclick="showPage('orders')" style="padding: 1rem 2rem; background: var(--gold); color: var(--black); border: none; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 0.95rem; letter-spacing: 1px; transition: all 0.3s; flex: 1;">
          📦 TRACK ORDER
        </button>
        <button onclick="redirectToHome()" style="padding: 1rem 2rem; background: var(--card2); border: 1.5px solid var(--gold); color: var(--gold); border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 0.95rem; letter-spacing: 1px; transition: all 0.3s; flex: 1;">
          🏠 GO HOME NOW
        </button>
      </div>
    </div>
  `;

  showModal("confirmationModal");
  
  // Start countdown timer (2 minutes = 120 seconds)
  startConfirmationCountdown(120);
}

/**
 * Start countdown timer for auto-redirect
 */
function startConfirmationCountdown(seconds) {
  let remainingSeconds = seconds;
  
  const countdownInterval = setInterval(() => {
    const minutes = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    const countdownElement = document.getElementById('redirectCountdown');
    if (countdownElement) {
      countdownElement.textContent = timeStr;
      
      // Change color as time runs out
      if (remainingSeconds <= 10) {
        countdownElement.style.color = '#e53935';
        countdownElement.style.fontSize = '2rem';
      } else if (remainingSeconds <= 30) {
        countdownElement.style.color = '#ff9800';
      }
    }
    
    remainingSeconds--;
    
    if (remainingSeconds < 0) {
      clearInterval(countdownInterval);
      redirectToHome();
    }
  }, 1000);
  
  // Store interval ID in case we need to clear it
  window.confirmationCountdownInterval = countdownInterval;
}

/**
 * Redirect to home page
 */
function redirectToHome() {
  if (window.confirmationCountdownInterval) {
    clearInterval(window.confirmationCountdownInterval);
  }
  hideModal("confirmationModal");
  showPage('home');
  window.scrollTo(0, 0);
}

// ======================== MODAL UTILITIES ========================
/**
 * Show modal
 */
function showModal(modalId) {
  const modal = document.getElementById(modalId);
  const overlay = document.querySelector(`.overlay[data-modal="${modalId}"]`) || 
                  (modal ? modal.closest(".overlay") : null);
  
  if (modal) modal.style.display = "block";
  if (overlay) overlay.classList.add("open");
}

/**
 * Hide modal
 */
function hideModal(modalId) {
  const modal = document.getElementById(modalId);
  const overlay = document.querySelector(`.overlay[data-modal="${modalId}"]`) || 
                  (modal ? modal.closest(".overlay") : null);
  
  if (modal) modal.style.display = "none";
  if (overlay) overlay.classList.remove("open");
}

/**
 * Handle login modal submission
 */
function handleAuthModal() {
  const tabs = document.querySelectorAll(".auth-tab");
  const forms = document.querySelectorAll(".auth-form");

  // Tab switching
  if (tabs.length > 0) {
    tabs.forEach(tab => {
      tab.addEventListener("click", function() {
        tabs.forEach(t => t.classList.remove("active"));
        forms.forEach(f => f.style.display = "none");
        
        this.classList.add("active");
        const tabName = this.dataset.tab;
        document.getElementById(tabName + "Form").style.display = "block";
      });
    });
  }

  // Login form
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = loginForm.querySelector("input[type='email']").value;
      const password = loginForm.querySelector("input[type='password']").value;
      
      const result = await loginUser(email, password);
      if (result.success) {
        hideModal("loginModal");
        alert(result.message);
      } else {
        alert("❌ " + result.error);
      }
    });
  }

  // Register form
  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = registerForm.querySelector("input[name='name']").value;
      const email = registerForm.querySelector("input[type='email']").value;
      const password = registerForm.querySelector("input[type='password']").value;
      
      const result = await registerUser(email, password, name);
      if (result.success) {
        hideModal("loginModal");
        alert(result.message);
      } else {
        alert("❌ " + result.error);
      }
    });
  }
}

/**
 * Handle checkout form
 */
function handleCheckoutForm() {
  const checkoutForm = document.getElementById("checkoutForm");
  if (checkoutForm) {
    checkoutForm.addEventListener("submit", (e) => {
      e.preventDefault();
      submitCheckoutForm();
    });
  }
}

// ======================== DOM UTILITIES ========================
/**
 * Initialize event listeners
 */
function initializeCheckout() {
  // Close modals on backdrop click
  const overlays = document.querySelectorAll(".overlay");
  overlays.forEach(overlay => {
    overlay.addEventListener("click", function(e) {
      if (e.target === this) {
        this.classList.remove("open");
        const modal = this.querySelector(".modal");
        if (modal) modal.style.display = "none";
      }
    });
  });

  // Close modals on X button
  const closeButtons = document.querySelectorAll(".modal-x");
  closeButtons.forEach(btn => {
    btn.addEventListener("click", function() {
      const modal = this.closest(".modal");
      const overlay = modal ? modal.closest(".overlay") : null;
      if (modal) modal.style.display = "none";
      if (overlay) overlay.classList.remove("open");
    });
  });

  // Setup auth modal
  handleAuthModal();

  // Setup checkout form
  handleCheckoutForm();

  // Setup cart (only if cart elements exist)
  try {
    if (document.querySelector(".cart-body")) {
      updateCartUI();
    }
  } catch(e) {
    console.log("Cart UI update skipped - elements not ready");
  }
}

// Run initialization when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeCheckout);
} else {
  initializeCheckout();
}

// Export for use in HTML
if (typeof window !== "undefined") {
  window.checkout = {
    addToCart,
    removeFromCart,
    updateCartQty,
    clearCart,
    proceedToCheckout,
    loginUser,
    registerUser,
    logoutUser
  };
}
