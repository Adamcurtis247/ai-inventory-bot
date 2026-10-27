const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./inventory.db', (err) => {
  if (err) {
    console.error('Erreur d\'ouverture de la base de données:', err.message);
  } else {
    console.log('📦 Connecté à la base de données SQLite (inventory.db).');
  }
});

db.serialize(() => {
  // Wipe old tables to ensure a clean multi-tenant setup
  db.run(`DROP TABLE IF EXISTS inventory`);
  db.run(`DROP TABLE IF EXISTS users`);

  // 1. Create Users Table
  db.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_name TEXT,
    email TEXT UNIQUE,
    telegram_chat_id TEXT,
    api_key TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 2. Create Inventory Table
  db.run(`CREATE TABLE inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    sku TEXT,
    item_name TEXT,
    current_stock INTEGER,
    reorder_threshold INTEGER,
    reorder_qty INTEGER,
    supplier_email TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // 3. Insert Store #1 (Alpha Store)
  db.run(`INSERT INTO users (id, store_name, email, api_key) 
          VALUES (1, 'Alpha Store', 'owner1@store.com', 'test_key_12345')`);
  db.run(`INSERT INTO inventory (id, user_id, sku, item_name, current_stock, reorder_threshold, reorder_qty, supplier_email) 
          VALUES (1, 1, 'TEST-01', 'Wireless Mouse (Alpha)', 10, 5, 50, 'supplier1@example.com')`);

  // 4. Insert Store #2 (Beta Store - Isolated Tenant)
  db.run(`INSERT INTO users (id, store_name, email, api_key) 
          VALUES (2, 'Beta Store', 'owner2@store.com', 'test_key_99999')`, (err) => {
    if (!err) {
      db.run(`INSERT INTO inventory (id, user_id, sku, item_name, current_stock, reorder_threshold, reorder_qty, supplier_email) 
              VALUES (2, 2, 'TEST-02', 'Mechanical Keyboard (Beta)', 15, 5, 30, 'supplier2@example.com')`);
      console.log("✅ Multi-tenant isolation seed complete: Alpha & Beta stores loaded.");
    }
  });
});

module.exports = db;