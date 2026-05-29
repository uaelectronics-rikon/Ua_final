// ============================================
// EMAIL QUEUE & RETRY SYSTEM
// ============================================
// Tracks failed emails and provides retry mechanism
// Helps ensure no customer emails are lost due to temporary connection issues
// Useful especially on cloud platforms (Render, Railway, Heroku) where DNS can be slow

const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, 'data', 'email-queue.json');
const LOG_FILE = path.join(__dirname, 'data', 'email-log.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// ============================================
// QUEUE MANAGEMENT
// ============================================

function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = fs.readFileSync(QUEUE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('❌ Error loading email queue:', e.message);
  }
  return [];
}

function saveQueue(queue) {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  } catch (e) {
    console.error('❌ Error saving email queue:', e.message);
  }
}

function addToQueue(to, orderData, pdfFilePath) {
  const queue = loadQueue();
  const queueItem = {
    id: `${orderData.orderId}-${Date.now()}`,
    to,
    orderData,
    pdfFilePath,
    attempts: 0,
    createdAt: new Date().toISOString(),
    nextRetry: new Date().toISOString(),
    status: 'pending'
  };
  
  queue.push(queueItem);
  saveQueue(queue);
  
  console.log(`📧 Email queued for retry: ${to} (Order: ${orderData.orderId})`);
  return queueItem;
}

function removeFromQueue(id) {
  const queue = loadQueue();
  const filtered = queue.filter(item => item.id !== id);
  saveQueue(filtered);
}

function getQueueSize() {
  return loadQueue().length;
}

function getQueueStats() {
  const queue = loadQueue();
  return {
    total: queue.length,
    pending: queue.filter(item => item.status === 'pending').length,
    failed: queue.filter(item => item.status === 'failed').length
  };
}

// ============================================
// LOGGING
// ============================================

function logEmail(to, orderData, success, error = null) {
  try {
    let logs = [];
    if (fs.existsSync(LOG_FILE)) {
      const data = fs.readFileSync(LOG_FILE, 'utf-8');
      logs = JSON.parse(data);
    }

    logs.push({
      timestamp: new Date().toISOString(),
      to,
      orderId: orderData.orderId,
      success,
      error: error ? error.message : null,
      errorCode: error ? error.code : null
    });

    // Keep last 500 entries to prevent file from getting too large
    if (logs.length > 500) {
      logs = logs.slice(-500);
    }

    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
  } catch (e) {
    console.error('❌ Error logging email:', e.message);
  }
}

function getEmailLogs(limit = 50) {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const data = fs.readFileSync(LOG_FILE, 'utf-8');
      const logs = JSON.parse(data);
      return logs.slice(-limit).reverse();
    }
  } catch (e) {
    console.error('❌ Error reading email logs:', e.message);
  }
  return [];
}

// ============================================
// EXPORTS
// ============================================

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
