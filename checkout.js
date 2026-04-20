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

  // Update modal content
  const content = modal.querySelector(".modal-content") || modal;
  content.innerHTML = `
    <div class="modal-x" onclick="hideModal('confirmationModal')">✕</div>
    <div style="text-align: center; padding: 20px;">
      <div style="font-size: 3rem; margin-bottom: 15px;">✅</div>
      <h2 style="color: #C9A227; margin-bottom: 10px;">ORDER PLACED SUCCESSFULLY</h2>
      <p style="color: #999; margin-bottom: 20px;">Thank you for your order!</p>
      
      <div style="background: var(--card); padding: 15px; border-radius: 8px; margin-bottom: 20px; text-align: left;">
        <p><strong>Order ID:</strong> ${orderId}</p>
        <p><strong>Total Amount:</strong> ₹${order.grand.toLocaleString("en-IN")}</p>
        <p><strong>Payment Method:</strong> ${order.paymentMethod === "online" ? "Online Payment" : "Cash on Delivery"}</p>
        <p><strong>Status:</strong> ${order.status}</p>
        <p style="font-size: 0.9rem; color: #999; margin-top: 10px;">📧 Confirmation email has been sent to ${order.customer.email}</p>
      </div>

      <button onclick="window.location.reload()" style="padding: 10px 25px; background: #C9A227; color: #080808; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">
        Continue Shopping
      </button>
    </div>
  `;

  showModal("confirmationModal");
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
