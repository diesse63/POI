const sqlite3 = require('sqlite3').verbose();

// URL del tuo Google Script
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyR0Km5Mk8QrjEsDneZG97U3zFLgvM5laL2z3awBizFdn9VUK40XZfEk25BaYxaysR9/exec';

const db = new sqlite3.Database('./mappa_poi.db');

async function importAll() {
    console.log("🚀 Inizio importazione completa...");

    try {
        // 1. Scarica TIPOLOGIE
        console.log("📥 Scaricamento Tipologie...");
        const resTipologie = await fetch(`${GAS_URL}?action=listTipologia`);
        const tipologie = await resTipologie.json();
        console.log(`✅ Scaricate ${tipologie.length} tipologie.`);

        // 2. Scarica POI
        console.log("📥 Scaricamento POI...");
        const resPois = await fetch(`${GAS_URL}?action=listPOI`);
        const pois = await resPois.json();
        console.log(`✅ Scaricati ${pois.length} POI.`);

        db.serialize(() => {
            // --- PASSO FONDAMENTALE: CREAZIONE TABELLE ---
            // Creiamo le tabelle se non esistono (così l'errore sparisce)
            console.log("🛠️  Verifica/Creazione struttura database...");
            db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user')`);
            db.run(`CREATE TABLE IF NOT EXISTS tipologie (id INTEGER PRIMARY KEY, tipo TEXT, colore TEXT)`);
            db.run(`CREATE TABLE IF NOT EXISTS pois (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, lat REAL, lng REAL, type INTEGER, note TEXT, link TEXT, FOREIGN KEY(user_id) REFERENCES users(id))`);

            // --- IMPORTAZIONE TIPOLOGIE ---
            console.log("💾 Salvataggio Tipologie...");
            db.run("DELETE FROM tipologie"); // Pulisce vecchi dati
            
            const stmtTipo = db.prepare("INSERT INTO tipologie (id, tipo, colore) VALUES (?, ?, ?)");
            tipologie.forEach(t => {
                stmtTipo.run(t.IDTipo, t.Tipo, t.Colore);
            });
            stmtTipo.finalize();

            // --- IMPORTAZIONE POI ---
            console.log("💾 Salvataggio POI...");
            db.run("DELETE FROM pois"); // Pulisce vecchi dati
            
            const stmtPoi = db.prepare("INSERT INTO pois (user_id, name, lat, lng, type, note, link) VALUES (?, ?, ?, ?, ?, ?, ?)");
            let count = 0;

            pois.forEach(p => {
                if (!p.Coordinate || !p.Coordinate.includes(',')) return;
                const parts = p.Coordinate.split(',').map(s => s.trim());
                const lat = parseFloat(parts[0]);
                const lng = parseFloat(parts[1]);

                if (isNaN(lat) || isNaN(lng)) return;

                // Assegna ad ADMIN (ID=1). 
                // Se l'utente admin non esiste ancora, verrà creato al primo avvio del server, ma l'ID 1 è standard.
                stmtPoi.run(1, p.Name, lat, lng, p.IDTipo, p.Note, p.Link);
                count++;
            });
            stmtPoi.finalize();
            
            console.log(`\n🎉 COMPLETATO! Importati: ${count} POI.`);
        });

    } catch (e) {
        console.error("❌ ERRORE:", e);
    }
}

importAll();