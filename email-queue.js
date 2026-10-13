// Persistent email retry queue and email log storage backed by Neon PostgreSQL.
const crypto = require("crypto");
const db = require("./db");

async function loadQueue() {
  return db.readCollection("email_queue");
}

async function saveQueue(queue) {
  if (!Array.isArray(queue)) throw new TypeError("Email queue must be an array");
  await db.replaceCollection("email_queue", queue);
}

async function addToQueue(to, orderData, pdfFilePath) {
  if (!orderData?.orderId) throw new Error("Cannot queue an email without an order ID");
  const queueItem = {
    id: `${orderData.orderId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    to,
    orderData,
    pdfFilePath: typeof pdfFilePath === "string" ? pdfFilePath : null,
    attempts: 0,
    createdAt: new Date().toISOString(),
    nextRetry: new Date().toISOString(),
    status: "pending"
  };

  await db.mutateCollection("email_queue", queue => {
    queue.push(queueItem);
    return { records: queue, result: queueItem };
  });
  console.log(`📧 Email queued for retry (Order: ${orderData.orderId})`);
  return queueItem;
}

async function removeFromQueue(id) {
  await db.mutateCollection("email_queue", queue => ({
    records: queue.filter(item => item.id !== id),
    result: undefined
  }));
}

async function getQueueSize() {
  return (await loadQueue()).length;
}

async function getQueueStats() {
  const queue = await loadQueue();
  return {
    total: queue.length,
    pending: queue.filter(item => item.status === "pending").length,
    failed: queue.filter(item => item.status === "failed").length
  };
}

async function logEmail(to, orderData, success, error = null) {
  try {
    await db.mutateCollection("email_logs", logs => {
      logs.push({
        timestamp: new Date().toISOString(),
        orderId: orderData?.orderId || null,
        success: Boolean(success),
        error: error ? String(error.message || error).slice(0, 1000) : null,
        errorCode: error?.code ? String(error.code).slice(0, 160) : null
      });
      if (logs.length > 500) logs.splice(0, logs.length - 500);
      return { records: logs, result: undefined };
    });
  } catch (e) {
    console.error("❌ Error logging email:", e.message);
  }
}

async function getEmailLogs(limit = 50) {
  try {
    const safeLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 50));
    return (await db.readCollection("email_logs")).slice(-safeLimit).reverse();
  } catch (e) {
    console.error("❌ Error reading email logs:", e.message);
    throw e;
  }
}

module.exports = {
  loadQueue,
  saveQueue,
  addToQueue,
  removeFromQueue,
  getQueueSize,
  getQueueStats,
  logEmail,
  getEmailLogs
};
