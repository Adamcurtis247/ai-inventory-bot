require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const db = require('./database');

const app = express();
app.use(express.json());

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

// Configure Nodemailer transporter using your .env credentials
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Store temporary user states for custom quantity input
const userStates = {};

// 1. ADD A NEW PRODUCT
app.post('/api/items', (req, res) => {
  const { sku, itemName, currentStock, reorderThreshold, reorderQty } = req.body;

  if (!sku || !itemName) {
    return res.status(400).json({ error: "SKU and itemName are required." });
  }

  const query = `INSERT INTO inventory (sku, item_name, current_stock, reorder_threshold, reorder_qty)
                 VALUES (?, ?, ?, ?, ?)`;

  db.run(query, [sku, itemName, currentStock || 10, reorderThreshold || 5, reorderQty || 25], function(err) {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    console.log(`➕ Product added: ${itemName} (SKU: ${sku})`);
    res.json({ message: "Product added successfully!", sku, itemName });
  });
});

// 2. MANUAL STOCK OVERRIDE (Owner sets exact stock)
app.patch('/api/inventory/:sku/stock', (req, res) => {
  const { sku } = req.params;
  const { newStock } = req.body;

  if (newStock === undefined || isNaN(newStock)) {
    return res.status(400).json({ error: "Please provide a valid 'newStock' number." });
  }

  db.run(`UPDATE inventory SET current_stock = ? WHERE sku = ?`, [newStock, sku], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Item not found." });

    console.log(`✏️ Manual stock update for ${sku}: Set to ${newStock} units.`);
    res.json({ message: "Stock updated manually by owner.", sku, currentStock: newStock });
  });
});

// 3. SIMULATE A SALE (WITH NEGATIVE STOCK SAFEGUARD)
app.post('/api/simulate-sale', (req, res) => {
  const { sku, quantitySold } = req.body;
  const qty = quantitySold || 1;

  db.get(`SELECT * FROM inventory WHERE sku = ?`, [sku], (err, item) => {
    if (err || !item) {
      return res.status(404).json({ error: "Item not found in database." });
    }

    // 🛑 SAFEGUARD: Reject sale if requested quantity exceeds current stock
    if (item.current_stock < qty) {
      console.log(`❌ Sale rejected for ${item.item_name}. Requested: ${qty}, Available: ${item.current_stock}`);
      return res.status(400).json({
        error: `Sale rejected! Requested: ${qty}, but only ${item.current_stock} units in stock.`,
        availableStock: item.current_stock
      });
    }

    const updatedStock = item.current_stock - qty;

    db.run(`UPDATE inventory SET current_stock = ? WHERE sku = ?`, [updatedStock, sku], async () => {
      console.log(`📉 Sale recorded for ${item.item_name}. New Stock: ${updatedStock}`);

      if (updatedStock <= item.reorder_threshold) {
        console.log(`🚨 Stock low for ${item.item_name}! Sending Telegram alert...`);

        if (token && chatId) {
          // ✨ Detailed message showing exact product name, SKU, and precise stock
          const message = `🚨 **LOW STOCK ALERT** 🚨\n\n` +
                          `📦 **Product:** ${item.item_name}\n` +
                          `🏷️ **SKU:** ${item.sku}\n` +
                          `📉 **Quantity Left:** ${updatedStock} units\n` +
                          `⚙️ **Alert Threshold:** ${item.reorder_threshold}\n` +
                          `⚡ **Default Restock Qty:** ${item.reorder_qty}`;

          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
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

// TELEGRAM POLLING & INTERACTIVE ENGINE
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

          // A. Handle Button Clicks
          if (update.callback_query) {
            const query = update.callback_query;
            const actionData = query.data;
            const messageId = query.message.message_id;

            // Option 1: Quick Restock with default amount
            if (actionData.startsWith('restock_')) {
              const parts = actionData.split('_');
              const sku = parts[1];
              const qtyToAdd = parseInt(parts[2], 10);

              processRestock(sku, qtyToAdd, messageId, query.id);
            } 
            
            // Option 2: Ask for Custom Quantity
            else if (actionData.startsWith('custom_')) {
              const sku = actionData.replace('custom_', '');

              userStates[chatId] = { action: 'awaiting_custom_qty', sku, messageId };

              await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
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

          // B. Handle Text Reply from Owner
          if (update.message && update.message.text && userStates[chatId]) {
            const state = userStates[chatId];

            if (state.action === 'awaiting_custom_qty') {
              const customQty = parseInt(update.message.text.trim(), 10);

              if (isNaN(customQty) || customQty <= 0) {
                await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: chatId,
                    text: "❌ Invalid number. Please reply with a valid positive integer."
                  })
                });
              } else {
                delete userStates[chatId];
                processRestock(state.sku, customQty, state.messageId);

                await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: chatId,
                    text: `✅ **Success!** Order request for **${customQty} units** sent to the supplier. Inventory updated.`,
                    parse_mode: 'Markdown'
                  })
                });
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

// RESTOCK HELPER
function processRestock(sku, qtyToAdd, originalMessageId, callbackQueryId = null) {
  db.get(`SELECT * FROM inventory WHERE sku = ?`, [sku], (err, item) => {
    if (item) {
      const newStock = item.current_stock + qtyToAdd;

      db.run(`UPDATE inventory SET current_stock = ? WHERE sku = ?`, [newStock, sku], async () => {
        console.log(`✅ Order processed! ${item.item_name} (+${qtyToAdd}). New stock: ${newStock}`);

        // Fire real email via Nodemailer to the supplier
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: process.env.SUPPLIER_DESTINATION_EMAIL,
          subject: `Purchase Order: ${item.item_name} (${item.sku})`,
          text: `Hello,\n\nPlease restock the following item:\n\nItem Name: ${item.item_name}\nSKU: ${item.sku}\nQuantity Ordered: ${qtyToAdd}\n\nThank you!`
        };

        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            console.log(`❌ [EMAIL ERROR]:`, error);
          } else {
            console.log(`📧 [EMAIL SENT]:`, info.response);
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
              text: `🚨 **LOW STOCK ALERT** 🚨\n\n📦 **Product:** ${item.item_name}\n🏷️ **SKU:** ${item.sku}\n\n✅ **Supplier Request Sent!**\nOrdered Quantity: ${qtyToAdd}\nNew Stock Level in DB: ${newStock}`,
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
  console.log(`🚀 Server active on port ${PORT}`);
  startTelegramPolling();
});