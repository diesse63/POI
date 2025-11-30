const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // Fondamentale per Railway
const SECRET_KEY = "chiave_segreta_locale_super_sicura";

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '.'))); // Serve index.html dalla root

// Connessione Database (crea il file se non esiste)
const db = new sqlite3.Database('./mappa_poi.db', (err) => {
    if (err) console.error("Errore apertura DB:", err.message);
    else console.log("Connesso al database SQLite.");
});

// --- INIZIALIZZAZIONE DATABASE ---
db.serialize(() => {
    // 1. Attiva Foreign Keys
    db.run("PRAGMA foreign_keys = ON");

    // 2. Crea Tabelle
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS tipologie (
        id INTEGER PRIMARY KEY,
        tipo TEXT,
        colore TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS pois (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        lat REAL,
        lng REAL,
        type INTEGER,
        note TEXT,
        link TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // 3. CREAZIONE ADMIN DI DEFAULT (Solo se non esistono utenti)
    db.get("SELECT count(*) as count FROM users", [], (err, row) => {
        if (err) return console.error(err);
        if (row.count === 0) {
            console.log("--- PRIMO AVVIO: Creazione Utente Admin ---");
            const passwordHash = bcrypt.hashSync('admin', 10); // Password: 'admin'
            db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, ['admin', passwordHash, 'admin'], (err) => {
                if (err) console.error("Errore creazione admin:", err);
                else console.log("UTENTE CREATO -> User: 'admin', Pass: 'admin'");
            });
        }
    });

    // 4. CREAZIONE TIPOLOGIE BASE (Solo se la tabella è vuota)
    db.get("SELECT count(*) as count FROM tipologie", [], (err, row) => {
        if (err) return console.error(err);
        if (row.count === 0) {
            console.log("--- PRIMO AVVIO: Inserimento Tipologie Base ---");
            const stmt = db.prepare("INSERT INTO tipologie (id, tipo, colore) VALUES (?, ?, ?)");
            stmt.run(1, "Generico", "blue");
            stmt.run(2, "Natura", "green");
            stmt.run(3, "Cultura", "purple");
            stmt.run(4, "Servizi", "orange");
            stmt.run(5, "Ristorazione", "red");
            stmt.finalize();
            console.log("Tipologie inserite.");
        }
    });
});

// --- MIDDLEWARE AUTENTICAZIONE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- ROTTE DI LOGIN ---
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err) return res.status(500).json({ error: "Errore DB" });
        if (!user) return res.status(403).json({ error: "Utente non trovato" });

        // Se ADMIN: Controlla la password
        if (user.role === 'admin') {
            const match = await bcrypt.compare(password, user.password);
            if (!match) return res.status(403).json({ error: "Password errata" });
        }
        // Se USER: Ignora la password (accesso libero col nome utente)

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY, { expiresIn: '30d' });
        res.json({ token, role: user.role, username: user.username });
    });
});

// --- ROTTE POI (Punti di Interesse) ---
// Leggi tutti i POI (filtrati per utente se non admin)
app.get('/pois', authenticateToken, (req, res) => {
    let query = "SELECT pois.*, users.username as owner FROM pois JOIN users ON pois.user_id = users.id";
    let params = [];

    // Se non è admin, vede solo i suoi (rimuovi questo IF se vuoi che tutti vedano tutto)
    if (req.user.role !== 'admin') {
        query += " WHERE pois.user_id = ?";
        params.push(req.user.id);
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Aggiungi POI
app.post('/pois', authenticateToken, (req, res) => {
    const { name, lat, lng, type, note, link } = req.body;
    db.run(`INSERT INTO pois (user_id, name, lat, lng, type, note, link) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
        [req.user.id, name, lat, lng, type, note, link], 
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "POI Aggiunto", id: this.lastID });
        }
    );
});

// Modifica POI
app.put('/pois/:id', authenticateToken, (req, res) => {
    const { name, type, note, link } = req.body;
    // Controlla che il POI appartenga all'utente (o sia admin)
    db.get("SELECT user_id FROM pois WHERE id = ?", [req.params.id], (err, row) => {
        if (!row) return res.status(404).json({ error: "POI non trovato" });
        if (req.user.role !== 'admin' && row.user_id !== req.user.id) return res.status(403).json({ error: "Non autorizzato" });

        db.run(`UPDATE pois SET name=?, type=?, note=?, link=? WHERE id=?`, 
            [name, type, note, link, req.params.id], 
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Aggiornato" });
            }
        );
    });
});

// Elimina POI
app.delete('/pois/:id', authenticateToken, (req, res) => {
    db.get("SELECT user_id FROM pois WHERE id = ?", [req.params.id], (err, row) => {
        if (!row) return res.status(404).json({ error: "POI non trovato" });
        if (req.user.role !== 'admin' && row.user_id !== req.user.id) return res.status(403).json({ error: "Non autorizzato" });

        db.run(`DELETE FROM pois WHERE id=?`, [req.params.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Eliminato" });
        });
    });
});

// --- ROTTE TIPOLOGIE ---
app.get('/tipologie', (req, res) => {
    db.all("SELECT id as IDTipo, tipo as Tipo, colore as Colore FROM tipologie", [], (err, rows) => {
        res.json(rows || []);
    });
});

// --- ROTTE ADMIN (Gestione Utenti) ---
app.get('/users', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    db.all("SELECT id, username, role FROM users", [], (err, rows) => res.json(rows));
});

app.post('/users', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    const { username } = req.body;
    
    // Crea utente con password finta (hashata)
    const dummyHash = bcrypt.hashSync('nopass', 10);
    
    db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, 'user')`, [username, dummyHash], (err) => {
        if (err) return res.status(400).json({ error: "Username già esistente o errore DB" });
        res.json({ message: "Utente creato" });
    });
});

app.delete('/users/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: "Non puoi eliminare te stesso" });

    db.serialize(() => {
        db.run("DELETE FROM pois WHERE user_id = ?", [req.params.id]); // Cancella prima i POI dell'utente
        db.run("DELETE FROM users WHERE id = ?", [req.params.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Utente eliminato" });
        });
    });
});

// Avvio Server
app.listen(PORT, () => {
    console.log(`Server avviato su porta ${PORT}`);
});