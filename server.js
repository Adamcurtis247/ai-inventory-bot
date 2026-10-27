require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('./database');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const token = process.env.TELEGRAM_BOT_TOKEN;

// Configure Nodemailer transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const userStates = {};

// ==========================================
// WEB ONBOARDING PAGE (GET /)
// ==========================================
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Store Inventory SaaS Onboarding</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: #1e293b; padding: 40px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); width: 400px; }
        h2 { margin-top: 0; color: #38bdf8; text-align: center; }
        label { display: block; margin-top: 15px; font-size: 14px; color: #94a3b8; }
        input { width: 100%; padding: 10px; margin-top: 5px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: white; box-sizing: border-box; }
        button { width: 100%; margin-top: 25px; background: #0284c7; color: white; border: none; padding: 12px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: background 0.2s; }
        button:hover { background: #0369a1; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>🚀 Store Onboarding</h2>
        <form action="/api/register" method="POST">
          <label>Store Name</label>
          <input type="text" name="storeName" placeholder="My Awesome Store" required>

          <label>Owner Email</label>
          <input type="email" name="email" placeholder="owner@mystore.com" required>

          <label>Initial Product Name</label>
          <input type="text" name="itemName" placeholder="Wireless Mouse" required>

          <label>SKU Code</label>
          <input type="text" name="sku" placeholder="MS-001" required>

          <label>Initial Stock Qty</label>
          <input type="number" name="currentStock" value="10" required>

          <label>Supplier Email (for automated POs)</label>
          <input type="email" name="supplierEmail" placeholder="supplier@factory.com" required>

          <button type="submit">Create Store & Get API Key</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// ==========================================
// PUBLIC REGISTRATION ENDPOINT (POST /api/register)
// ==========================================
app.post('/api/register', (req, res) => {
  const storeName = req.body.storeName?.trim();
  const email = req.body.email?.trim();
  const itemName = req.body.itemName?.trim();
  const sku = req.body.sku?.trim().toUpperCase();
  const currentStock = req.body.currentStock;
  const supplierEmail = req.body.supplierEmail?.trim();

  if (!storeName || !email || !itemName || !sku || !supplierEmail) {
    return res.status(400).json({ error: "All fields are required." });
  }

  const apiKey = `sk_live_${crypto.randomBytes(16).toString('hex')}`;

  db.run(`INSERT INTO users (store_name, email, api_key) VALUES (?, ?, ?)`, [storeName, email, apiKey], function(err) {
    if (err) {
      return res.status(400).json({ error: "Registration failed. Email might already be registered." });
    }

    const userId = this.lastID;

    db.run(
      `INSERT INTO inventory (user_id, sku, item_name, current_stock, reorder_threshold, reorder_qty, supplier_email) 
       VALUES (?, ?, ?, ?, 5, 25, ?)`,
      [userId, sku, itemName, currentStock || 10, supplierEmail],
      (invErr) => {
        if (invErr) {
          return res.status(400).json({ error: invErr.message });
        }

        console.log(`🎉 New Store Registered: ${storeName} (${email}) | SKU: ${sku}`);

        res.send(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <title>Registration Successful</title>
            <style>
              body { font-family: -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
              .card { background: #1e293b; padding: 40px; border-radius: 12px; width: 450px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
              h2 { color: #10b981; margin-top: 0; }
              .box { background: #0f172a; padding: 12px; border-radius: 6px; border: 1px solid #334155; font-family: monospace; color: #38bdf8; margin: 10px 0; word-break: break-all; }
              p { font-size: 14px; color: #94a3b8; line-height: 1.5; }
              a { display: block; text-align: center; margin-top: 20px; color: #38bdf8; text-decoration: none; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>✅ Store Successfully Created!</h2>
              <p>Your store <strong>${storeName}</strong> is ready. Save your API key below—you will need it for your e-commerce platform webhooks:</p>
              
              <label>Your Secure API Key</label>
              <div class="box">${apiKey}</div>

              <p>🤖 <strong>Next Step (Telegram Link):</strong><br>
              Open your Telegram bot and send this exact command to link your account:</p>
              <div class="box">/link ${email}</div>

              <a href="/">← Register Another Store</a>
            </div>
          </body>
          </html>
        `);
      }
    );
  });
});

// ==========================================
// GET STORE INVENTORY (Secured by API Key)
// ==========================================
app.get('/api/items', (req, res) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: "Missing API Key in headers." });
  }

  db.get(`SELECT id, store_name FROM users WHERE api_key = ?`, [apiKey], (err, user) => {
    if (err || !user) {
      return res.status(403).json({ error: "Invalid API Key." });
    }

    db.all(`SELECT sku, item_name, current_stock, reorder_threshold, supplier_email FROM inventory WHERE user_id = ?`, [user.id], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ store: user.store_name, inventory: rows });
    });
  });
});

// ==========================================
// 1. ADD A NEW PRODUCT (Secured by API Key)
// ==========================================
app.post('/api/items', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const sku = req.body.sku?.trim().toUpperCase();
  const itemName = req.body.itemName?.trim();
  const currentStock = req.body.currentStock;
  const reorderThreshold = req.body.reorderThreshold;
  const reorderQty = req.body.reorderQty;
  const supplierEmail = req.body.supplierEmail?.trim();

  if (!apiKey) {
    return res.status(401).json({ error: "Missing API Key in headers." });
  }

  db.get(`SELECT id FROM users WHERE api_key = ?`, [apiKey], (err, user) => {
    if (err || !user) {
      return res.status(403).json({ error: "Invalid API Key." });
    }

    if (!sku || !itemName || !supplierEmail) {
      return res.status(400).json({ error: "SKU, itemName, and supplierEmail are required." });
    }

    db.run(
      `INSERT INTO inventory (user_id, sku, item_name, current_stock, reorder_threshold, reorder_qty, supplier_email) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.id, sku, itemName, currentStock || 10, reorderThreshold || 5, reorderQty || 25, supplierEmail],
      function(err) {
        if (err) return res.status(400).json({ error: err.message });
        console.log(`➕ Product added for User #${user.id}: ${itemName} (SKU: ${sku})`);
        res.json({ message: "Product added successfully!", sku, itemName, supplierEmail });
      }
    );
  });
});

// ==========================================
// 2. SIMULATE A SALE (Secured by API Key)
// ==========================================
app.post('/api/simulate-sale', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const sku = req.body.sku?.trim().toUpperCase();
  const qty = req.body.quantitySold || 1;

  if (!apiKey) {
    return res.status(401).json({ error: "Missing API Key in headers." });
  }

  db.get(`SELECT id, telegram_chat_id FROM users WHERE api_key = ?`, [apiKey], (err, user) => {
    if (err || !user) {
      return res.status(403).json({ error: "Invalid API Key." });
    }

    db.get(`SELECT * FROM inventory WHERE user_id = ? AND sku = ?`, [user.id, sku], (err, item) => {
      if (err || !item) {
        return res.status(404).json({ error: `Item with SKU '${sku}' not found in your store's inventory.` });
      }

      if (item.current_stock < qty) {
        return res.status(400).json({
          error: `Sale rejected! Requested: ${qty}, but only ${item.current_stock} units in stock.`,
          availableStock: item.current_stock
        });
      }

      const updatedStock = item.current_stock - qty;

      db.run(`UPDATE inventory SET current_stock = ? WHERE id = ?`, [updatedStock, item.id], async () => {
        console.log(`📉 Sale recorded for ${item.item_name} (User #${user.id}). New Stock: ${updatedStock}`);

        if (updatedStock <= item.reorder_threshold) {
          if (token && user.telegram_chat_id) {
            const message = `🚨 **LOW STOCK ALERT** 🚨\n\n` +
                            `📦 **Product:** ${item.item_name}\n` +
                            `🏷️ **SKU:** ${item.sku}\n` +
                            `📉 **Quantity Left:** ${updatedStock} units\n` +
                            `⚙️ **Alert Threshold:** ${item.reorder_threshold}\n` +
                            `⚡ **Default Restock Qty:** ${item.reorder_qty}\n` +
                            `✉️ **Supplier:** ${item.supplier_email}`;

            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: user.telegram_chat_id,
                text: message,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: "📩 Order Custom Qty", callback_data: `custom_${item.sku}` },
                      { text: `⚡ Quick Restock (${item.reorder_qty})`, callback_data: `restock_${item.sku}_${item.reorder_qty}` }
                    ]
                  ]
                }
              })
            });
          }
        }

        res.json({ message: "Sale processed", sku, newStock: updatedStock, alertTriggered: updatedStock <= item.reorder_threshold });
      });
    });
  });
});

// ==========================================
// TELEGRAM POLLING & INTERACTIVE ENGINE
// ==========================================
async function startTelegramPolling() {
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
  } catch (err) {}

  let offset = 0;
  console.log("🤖 Listening for Telegram interactions...");

  async function poll() {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=5`);
      const data = await response.json();

      if (data.ok && data.result) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const incomingChatId = update.message?.chat?.id?.toString() || update.callback_query?.message?.chat?.id?.toString();

          if (update.callback_query) {
            const query = update.callback_query;
            const actionData = query.data;
            const messageId = query.message.message_id;

            if (actionData.startsWith('restock_')) {
              const parts = actionData.split('_');
              const sku = parts[1];
              const qtyToAdd = parseInt(parts[2], 10);

              processRestock(incomingChatId, sku, qtyToAdd, messageId, query.id);
            } 
            else if (actionData.startsWith('custom_')) {
              const sku = actionData.replace('custom_', '');

              userStates[incomingChatId] = { action: 'awaiting_custom_qty', sku, messageId };

              await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: incomingChatId,
                  text: `💬 Reply with the exact quantity you want to order for SKU ${sku}:`,
                  reply_markup: { force_reply: true }
                })
              });

              await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: query.id })
              });
            }
          }

          if (update.message && update.message.text) {
            const text = update.message.text.trim();

            if (text.startsWith('/link ')) {
              const email = text.replace('/link ', '').trim();

              db.run(`UPDATE users SET telegram_chat_id = ? WHERE email = ?`, [incomingChatId, email], function(err) {
                if (err || this.changes === 0) {
                  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: incomingChatId, text: "❌ Email not found in our system. Please register first on our website." })
                  });
                } else {
                  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      chat_id: incomingChatId, 
                      text: `✅ **Success!** Your Telegram is linked to: ${email}\nYou will now receive low-stock alerts here.`,
                      parse_mode: 'Markdown'
                    })
                  });
                }
              });
            }
            else if (text === '/status' || text === '/stock') {
              db.get(`SELECT id FROM users WHERE telegram_chat_id = ?`, [incomingChatId], (err, user) => {
                if (err || !user) {
                  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: incomingChatId, text: "❌ Your Telegram is not linked. Send `/link your-email@store.com` first." })
                  });
                  return;
                }

                db.all(`SELECT * FROM inventory WHERE user_id = ?`, [user.id], async (err, rows) => {
                  if (err || rows.length === 0) {
                    await sendTelegramMessage(incomingChatId, "❌ No items found in your store's inventory.");
                    return;
                  }

                  let report = "📦 **Your Store Inventory & Suppliers:**\n\n";
                  rows.forEach(item => {
                    report += `• **${item.item_name}** (${item.sku})\n  Stock: ${item.current_stock} | Threshold: ${item.reorder_threshold}\n  Supplier: ${item.supplier_email}\n\n`;
                  });

                  await sendTelegramMessage(incomingChatId, report);
                });
              });
            }
            else if (userStates[incomingChatId] && userStates[incomingChatId].action === 'awaiting_custom_qty') {
              const state = userStates[incomingChatId];
              const customQty = parseInt(text, 10);

              if (isNaN(customQty) || customQty <= 0) {
                await sendTelegramMessage(incomingChatId, "❌ Invalid number. Please reply with a valid positive integer.");
              } else {
                delete userStates[incomingChatId];
                processRestock(incomingChatId, state.sku, customQty, state.messageId);

                await sendTelegramMessage(incomingChatId, `✅ **Success!** Order request for **${customQty} units** sent to the supplier.`);
              }
            }
          }
        }
      }
    } catch (err) {}

    setTimeout(poll, 1000);
  }

  poll();
}

async function sendTelegramMessage(targetChatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: targetChatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
}

function processRestock(chatId, sku, qtyToAdd, originalMessageId, callbackQueryId = null) {
  db.get(`SELECT users.id as user_id, inventory.* FROM inventory JOIN users ON inventory.user_id = users.id WHERE users.telegram_chat_id = ? AND inventory.sku = ?`, [chatId, sku], (err, item) => {
    if (item) {
      const newStock = item.current_stock + qtyToAdd;

      db.run(`UPDATE inventory SET current_stock = ? WHERE id = ?`, [newStock, item.id], async () => {
        console.log(`✅ Order processed for User #${item.user_id}! ${item.item_name} (+${qtyToAdd}). New stock: ${newStock}`);

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: item.supplier_email,
          subject: `Purchase Order: ${item.item_name} (${item.sku})`,
          text: `Hello,\n\nPlease restock the following item:\n\nItem Name: ${item.item_name}\nSKU: ${item.sku}\nQuantity Ordered: ${qtyToAdd}\n\nThank you!`
        };

        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            console.log(`❌ [EMAIL ERROR]:`, error);
          } else {
            console.log(`📧 [EMAIL SENT to ${item.supplier_email}]:`, info.response);
          }
        });

        if (callbackQueryId) {
          await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              callback_query_id: callbackQueryId,
              text: `Supplier requested! New stock: ${newStock}`
            })
          });
        }

        if (originalMessageId) {
          await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: originalMessageId,
              text: `🚨 **LOW STOCK ALERT** 🚨\n\n📦 **Product:** ${item.item_name}\n🏷️ **SKU:** ${item.sku}\n✉️ **Supplier:** ${item.supplier_email}\n\n✅ **Supplier Request Sent!**\nOrdered Quantity: ${qtyToAdd}\nNew Stock Level in DB: ${newStock}`,
              parse_mode: 'Markdown'
            })
          });
        }
      });
    }
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SaaS Onboarding Server active on port ${PORT}`);
  startTelegramPolling();
});