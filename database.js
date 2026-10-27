const sqlite3 = require('sqlite3').verbose();

// Connexion à la base de données (ou création du fichier s'il n'existe pas)
const db = new sqlite3.Database('./inventory.db', (err) => {
  if (err) {
    console.error('Erreur d\'ouverture de la base de données:', err.message);
  } else {
    console.log('📦 Connecté à la base de données SQLite (inventory.db).');
  }
});

// Initialisation des tables
db.serialize(() => {
  // Table des utilisateurs (pour le futur modèle SaaS multi-utilisateurs)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    telegram_chat_id TEXT
  )`);

  // Table des articles en stock
  db.run(`CREATE TABLE IF NOT EXISTS inventory (
    sku TEXT PRIMARY KEY,
    item_name TEXT,
    current_stock INTEGER,
    reorder_threshold INTEGER,
    reorder_qty INTEGER
  )`);

  // Insertion d'un article de test par défaut
  db.run(`INSERT OR IGNORE INTO inventory (sku, item_name, current_stock, reorder_threshold, reorder_qty)
          VALUES ('TEST-01', 'Wireless Mouse', 3, 5, 50)`);
});

module.exports = db;