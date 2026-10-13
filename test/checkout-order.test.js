const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

const projectRoot = path.join(__dirname, "..");
const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ua-electronics-checkout-"));
const productsFile = path.join(testDataDirectory, "products.json");
const ordersFile = path.join(testDataDirectory, "orders.json");
const intentsFile = path.join(testDataDirectory, "payment-intents.json");
const pdfDirectory = path.join(testDataDirectory, "Orders");
const originalCatalog = fs.readFileSync(path.join(projectRoot, "data", "products.json"));

process.env.NODE_ENV = "test";
process.env.UA_DATA_DIR = testDataDirectory;
process.env.UA_PRODUCTS_FILE = productsFile;
process.env.UA_ORDERS_PDF_DIR = pdfDirectory;
process.env.RAZORPAY_KEY_ID = "rzp_test_checkout";
process.env.RAZORPAY_KEY_SECRET = "test-only-secret";

let testEmailSender = async () => true;
const emailModulePath = require.resolve("../email");
require.cache[emailModulePath] = {
  id: emailModulePath,
  filename: emailModulePath,
  loaded: true,
  exports: (...args) => testEmailSender(...args)
};

const { app, processOrderOutbox, razorpay } = require("../server");
const httpServer = app.listen(0);
let baseUrl;
let catalog;

test.before(async () => {
  await new Promise(resolve => httpServer.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  fs.writeFileSync(productsFile, originalCatalog);
  catalog = JSON.parse(originalCatalog.toString("utf8"));
  resetStore();
});

test.after(async () => {
  await new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
});

function resetStore() {
  fs.writeFileSync(ordersFile, "[]");
  fs.writeFileSync(intentsFile, "[]");
  fs.writeFileSync(productsFile, originalCatalog);
}

function makeOrder(overrides = {}) {
  const product = catalog[0];
  const qty = overrides.qty ?? 1;
  const subtotal = product.price * qty;
  const shipping = subtotal >= 999 ? 0 : 49;
  return {
    orderId: overrides.orderId || `UAE${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    date: new Date().toISOString(),
    customer: {
      name: "Checkout Test",
      mobile: "9876543210",
      email: "checkout-test@example.invalid",
      addr1: "Test house 1",
      addr2: "Test street",
      city: "Test City",
      state: "Delhi",
      pin: "110001",
      notes: ""
    },
    items: [{
      id: product.id,
      name: product.name,
      brand: product.brand,
      icon: product.icon,
      price: product.price,
      qty,
      subtotal
    }],
    subtotal,
    shipping,
    grand: subtotal + shipping,
    paymentMethod: overrides.paymentMethod || "cod",
    paid: overrides.paid ?? false,
    paymentStatus: overrides.paymentStatus || "Pending",
    status: "Confirmed"
  };
}

async function post(route, body, options = {}) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal
  });
}

async function readBody(response) {
  return response.json();
}

test("COD order confirms promptly while a 60-second email delivery remains pending", async () => {
  resetStore();
  const order = makeOrder();
  const startedAt = Date.now();
  const response = await post("/save-order", order);
  const payload = await readBody(response);
  assert.equal(response.status, 201);
  assert.equal(payload.success, true);
  assert.equal(payload.order.paid, false);
  assert.equal(payload.order.paymentStatus, "Pending");
  assert.equal(payload.order.grand, order.grand);
  assert.ok(Date.now() - startedAt < 2000, "confirmation response should not wait for notifications");
  assert.equal(JSON.parse(fs.readFileSync(ordersFile, "utf8")).length, 1);

  let finishPdf;
  let finishEmail;
  let pdfStarted = false;
  let pdfSettled = false;
  let emailStarted = false;
  let emailSettled = false;
  const processing = processOrderOutbox({
    pdfGenerator: async () => {
      pdfStarted = true;
      await new Promise(resolve => { finishPdf = resolve; });
      pdfSettled = true;
      return { filePath: path.join(pdfDirectory, `${order.orderId}.pdf`) };
    },
    emailSender: async () => {
      emailStarted = true;
      await new Promise(resolve => { finishEmail = resolve; });
      emailSettled = true;
      return true;
    }
  });
  while (!pdfStarted) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(pdfSettled, false, "PDF generation may remain delayed after order confirmation");

  const statusWhilePdfPending = await post("/api/order-status", {
    orderId: order.orderId,
    email: order.customer.email,
    order
  });
  assert.equal((await readBody(statusWhilePdfPending)).state, "confirmed");
  finishPdf();
  while (!emailStarted) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(emailSettled, false, "notification work must remain pending after order confirmation");

  const statusResponse = await post("/api/order-status", {
    orderId: order.orderId,
    email: order.customer.email,
    order
  });
  assert.equal(statusResponse.status, 200);
  assert.equal((await readBody(statusResponse)).state, "confirmed");
  assert.equal(emailSettled, false, "order status remains confirmed while email delivery is pending");
  finishEmail();
  await processing;
});

test("catalog validation rejects missing products, stock, quantities, and client prices", async () => {
  resetStore();

  const missingProduct = makeOrder();
  missingProduct.items[0].id = "missing-product";
  let response = await post("/save-order", missingProduct);
  assert.equal(response.status, 409);
  assert.equal((await readBody(response)).code, "ITEMS_MISSING");

  const invalidQuantity = makeOrder({ qty: 0 });
  invalidQuantity.items[0].qty = 0;
  invalidQuantity.items[0].subtotal = 0;
  invalidQuantity.subtotal = 0;
  invalidQuantity.shipping = 49;
  invalidQuantity.grand = 49;
  response = await post("/save-order", invalidQuantity);
  assert.equal(response.status, 400);

  const tamperedPrice = makeOrder();
  tamperedPrice.items[0].price += 1;
  response = await post("/save-order", tamperedPrice);
  assert.equal(response.status, 409);
  assert.equal((await readBody(response)).code, "PRICE_CHANGED");

  const tamperedTotal = makeOrder();
  tamperedTotal.grand += 100;
  response = await post("/save-order", tamperedTotal);
  assert.equal(response.status, 409);
  assert.equal((await readBody(response)).code, "TOTAL_CHANGED");

  const unavailableCatalog = [...catalog];
  unavailableCatalog[0] = { ...unavailableCatalog[0], inStock: false };
  fs.writeFileSync(productsFile, JSON.stringify(unavailableCatalog));
  response = await post("/save-order", makeOrder());
  assert.equal(response.status, 409);
  assert.equal((await readBody(response)).code, "OUT_OF_STOCK");
  fs.writeFileSync(productsFile, originalCatalog);
});

test("a lost client response can be resolved and safely retried without a duplicate", async () => {
  resetStore();
  const order = makeOrder();
  const controller = new AbortController();
  const response = await post("/save-order", order, { signal: controller.signal });
  assert.equal(response.status, 201);
  controller.abort();
  await response.text().catch(() => {});

  const statusResponse = await post("/api/order-status", {
    orderId: order.orderId,
    email: order.customer.email,
    order
  });
  assert.equal(statusResponse.status, 200);
  assert.equal((await readBody(statusResponse)).state, "confirmed");

  const retry = await post("/save-order", order);
  assert.equal(retry.status, 200);
  assert.equal((await readBody(retry)).created, false);
  assert.equal(JSON.parse(fs.readFileSync(ordersFile, "utf8")).length, 1);
});

test("storage/catalog errors fail explicitly and a corrected retry can recover", async () => {
  resetStore();
  const order = makeOrder();
  fs.writeFileSync(productsFile, "{invalid catalog");
  let response = await post("/save-order", order);
  assert.equal(response.status, 503);
  assert.equal(JSON.parse(fs.readFileSync(ordersFile, "utf8")).length, 0);

  fs.writeFileSync(productsFile, originalCatalog);
  response = await post("/save-order", order);
  assert.equal(response.status, 201);
  assert.equal(JSON.parse(fs.readFileSync(ordersFile, "utf8")).length, 1);
});

test("simultaneous duplicate COD requests create exactly one order", async () => {
  resetStore();
  const order = makeOrder();
  const responses = await Promise.all([
    post("/save-order", order),
    post("/save-order", order)
  ]);
  const bodies = await Promise.all(responses.map(readBody));
  assert.ok(responses.every(response => response.ok));
  assert.equal(bodies.filter(body => body.created).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(ordersFile, "utf8")).length, 1);
});

test("Razorpay amounts are catalog-derived and captured payments are verified idempotently", async () => {
  resetStore();
  let gatewayOrder;
  let capturedAmount;
  razorpay.orders.create = async payload => {
    gatewayOrder = { id: "order_test_checkout", ...payload };
    return gatewayOrder;
  };
  razorpay.payments.fetch = async () => ({
    id: "pay_test_checkout",
    order_id: gatewayOrder.id,
    amount: capturedAmount ?? gatewayOrder.amount,
    currency: gatewayOrder.currency,
    status: "captured"
  });

  const order = makeOrder({ paymentMethod: "card" });
  const createResponse = await post("/api/create-order", order);
  assert.equal(createResponse.status, 200);
  const createdPayment = await readBody(createResponse);
  assert.equal(createdPayment.amount, order.grand * 100);

  const paymentId = "pay_test_checkout";
  const signature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${gatewayOrder.id}|${paymentId}`)
    .digest("hex");
  capturedAmount = gatewayOrder.amount + 100;
  let verifyResponse = await post("/api/verify-payment", {
    order_id: gatewayOrder.id,
    payment_id: paymentId,
    razorpay_signature: signature
  });
  assert.equal(verifyResponse.status, 400);
  assert.equal(JSON.parse(fs.readFileSync(ordersFile, "utf8")).length, 0);

  capturedAmount = gatewayOrder.amount;
  verifyResponse = await post("/api/verify-payment", {
    order_id: gatewayOrder.id,
    payment_id: paymentId,
    razorpay_signature: signature
  });
  assert.equal(verifyResponse.status, 201);
  let verified = await readBody(verifyResponse);
  assert.equal(verified.order.paid, true);
  assert.equal(verified.order.paymentStatus, "Paid");
  assert.equal(verified.order.grand, order.grand);

  verifyResponse = await post("/api/verify-payment", {
    order_id: gatewayOrder.id,
    payment_id: paymentId,
    razorpay_signature: signature
  });
  assert.equal(verifyResponse.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(ordersFile, "utf8")).length, 1);
});

test("PDF failures remain retryable and email failures remain queued", async () => {
  resetStore();
  const order = makeOrder();
  const response = await post("/save-order", order);
  assert.equal(response.status, 201);

  await processOrderOutbox({
    pdfGenerator: async () => { throw new Error("simulated PDF failure"); },
    emailSender: async () => false
  });
  const saved = JSON.parse(fs.readFileSync(ordersFile, "utf8"))[0];
  assert.equal(saved._postProcessing.pdf.status, "retrying");
  assert.equal(saved._postProcessing.pdf.attempts, 1);
  assert.equal(saved._postProcessing.email.status, "queued");
});

test("checkout frontend uses request timeouts, restores the button, and deduplicates analytics", () => {
  const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
  assert.match(html, /AbortController/);
  assert.match(html, /if \(orderSubmissionBusy\) return/);
  assert.match(html, /button\.disabled = busy/);
  assert.match(html, /ua_purchase_event_/);
  assert.match(html, /CHECK ORDER STATUS/);
});

test("the live root route serves the inline checkout handler, not checkout.js", async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /async function placeOrder\(\)/);
  assert.doesNotMatch(html, /<script[^>]+src=["']checkout\.js["']/);
});
