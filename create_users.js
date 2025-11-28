const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('./mappa_poi.db');

console.log("🛠️  Inizio creazione/ripristino utenti...");

db.serialize(() => {
    // 1. Assicura che la tabella esista (per sicurezza)
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user')`);

    // --- 2. GESTIONE ADMIN (admin / admin123) ---
    const adminPass = 'admin123';
    const adminHash = bcrypt.hashSync(adminPass, 10);

    // Prima cancelliamo l'admin vecchio (se c'è) per evitare errori
    db.run(`DELETE FROM users WHERE username = 'admin'`);
    
    // Poi lo ricreiamo pulito
    db.run(`INSERT INTO users (username, password, role) VALUES ('admin', ?, 'admin')`, [adminHash], (err) => {
        if (!err) console.log("✅ Utente 'admin' creato con successo (Password: admin123)");
        else console.error("❌ Errore creazione admin:", err.message);
    });

    // --- 3. GESTIONE UTENTE BOLOGNA (bologna / 2930) ---
    const userPass = '2930';
    const userHash = bcrypt.hashSync(userPass, 10);

    // Prima cancelliamo l'utente vecchio (se c'è)
    db.run(`DELETE FROM users WHERE username = 'bologna'`);

    // Poi lo ricreiamo pulito
    db.run(`INSERT INTO users (username, password, role) VALUES ('bologna', ?, 'user')`, [userHash], (err) => {
        if (!err) console.log("✅ Utente 'bologna' creato con successo (Password: 2930)");
        else console.error("❌ Errore creazione bologna:", err.message);
    });
});