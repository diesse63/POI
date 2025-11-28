const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const GAS_URL = 'https://script.google.com/macros/s/AKfycbyR0Km5Mk8QrjEsDneZG97U3zFLgvM5laL2z3awBizFdn9VUK40XZfEk25BaYxaysR9/exec';
const db = new sqlite3.Database('./mappa_poi.db');

async function resetAndImport() {
    console.log("💣 INIZIO RESET TOTALE (Assegnazione a Bologna)...");

    // 1. Prepara password hashate
    const adminPass = bcrypt.hashSync('admin123', 10);
    const userPass = bcrypt.hashSync('2930', 10);

    // 2. Scarica i dati
    console.log("📥 Scaricamento Dati Google...");
    try {
        const resTipo = await fetch(`${GAS_URL}?action=listTipologia`);
        const tipologie = await resTipo.json();
        const resPoi = await fetch(`${GAS_URL}?action=listPOI`);
        const pois = await resPoi.json();
        console.log(`✅ Dati scaricati: ${tipologie.length} tipologie, ${pois.length} POI.`);

        db.serialize(() => {
            // 3. Ricostruzione Database
            console.log("🛠️  Ricostruzione Database...");
            db.run("DROP TABLE IF EXISTS pois");
            db.run("DROP TABLE IF EXISTS tipologie");
            db.run("DROP TABLE IF EXISTS users");

            db.run(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user')`);
            db.run(`CREATE TABLE tipologie (id INTEGER PRIMARY KEY, tipo TEXT, colore TEXT)`);
            db.run(`CREATE TABLE pois (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, lat REAL, lng REAL, type INTEGER, note TEXT, link TEXT, FOREIGN KEY(user_id) REFERENCES users(id))`);

            // 4. Inserisci Utenti
            console.log("👤 Creazione Utenti...");
            const stmtUser = db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)");
            
            // L'ordine è importante per gli ID!
            stmtUser.run('admin', adminPass, 'admin'); // Diventa ID 1
            stmtUser.run('bologna', userPass, 'user'); // Diventa ID 2
            
            stmtUser.finalize();
            console.log("✅ Utente 'admin' (ID 1) creato.");
            console.log("✅ Utente 'bologna' (ID 2) creato.");

            // 5. Inserisci Tipologie
            console.log("🎨 Inserimento Tipologie...");
            const stmtTipo = db.prepare("INSERT INTO tipologie (id, tipo, colore) VALUES (?, ?, ?)");
            tipologie.forEach(t => stmtTipo.run(t.IDTipo, t.Tipo, t.Colore));
            stmtTipo.finalize();

            // 6. Inserisci POI (Assegnati a BOLOGNA, ID=2)
            console.log("📍 Inserimento POI per l'utente Bologna...");
            const stmtPoi = db.prepare("INSERT INTO pois (user_id, name, lat, lng, type, note, link) VALUES (?, ?, ?, ?, ?, ?, ?)");
            let count = 0;
            
            // ID DELL'UTENTE BOLOGNA = 2
            const TARGET_USER_ID = 2; 

            pois.forEach(p => {
                if (p.Coordinate && p.Coordinate.includes(',')) {
                    const parts = p.Coordinate.split(',');
                    const lat = parseFloat(parts[0]);
                    const lng = parseFloat(parts[1]);
                    if (!isNaN(lat) && !isNaN(lng)) {
                        // Qui usiamo TARGET_USER_ID invece di 1
                        stmtPoi.run(TARGET_USER_ID, p.Name, lat, lng, p.IDTipo, p.Note, p.Link);
                        count++;
                    }
                }
            });
            stmtPoi.finalize();
            
            console.log(`🎉 TUTTO COMPLETATO! Assegnati ${count} POI all'utente 'bologna'.`);
            console.log("👉 Ora puoi avviare 'npm start'!");
        });
    } catch (e) {
        console.error("❌ ERRORE:", e);
    }
}

resetAndImport();