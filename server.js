const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// RAILWAY FORNISCE LA PORTA TRAMITE ENV, ALTRIMENTI USA 3000
const PORT = process.env.PORT || 3000; 
const SECRET_KEY = "chiave_segreta_locale_super_sicura";

app.use(cors());
app.use(bodyParser.json());
// Serve i file statici (HTML, CSS, JS frontend) dalla cartella corrente
app.use(express.static(path.join(__dirname, '.')));

// Connessione DB
const db = new sqlite3.Database('./mappa_poi.db', (err) => {
    if (err) {
        console.error("ERRORE CRITICO DB:", err.message);
    } else {
        console.log("Connesso al database SQLite.");
    }
});

// Inizializzazione Tabelle e Dati
db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON");
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user')`);
    db.run(`CREATE TABLE IF NOT EXISTS tipologie (id INTEGER PRIMARY KEY, tipo TEXT, colore TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS pois (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, lat REAL, lng REAL, type INTEGER, note TEXT, link TEXT, FOREIGN KEY(user_id) REFERENCES users(id))`);

    // Primo avvio: Admin
    db.get("SELECT count(*) as count FROM users", [], (err, row) => {
        if (!err && row.count === 0) {
            console.log("Creazione Admin Default...");
            const hash = bcrypt.hashSync('admin', 10);
            db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, ['admin', hash, 'admin']);
        }
    });
    
    // Primo avvio: Tipologie
    db.get("SELECT count(*) as count FROM tipologie", [], (err, row) => {
        if (!err && row.count === 0) {
            console.log("Creazione Tipologie...");
            const stmt = db.prepare("INSERT INTO tipologie (id, tipo, colore) VALUES (?, ?, ?)");
            stmt.run(1, "Generico", "blue");
            stmt.run(2, "Natura", "green");
            stmt.run(3, "Cultura", "purple");
            stmt.run(4, "Servizi", "orange");
            stmt.run(5, "Ristorazione", "red");
            stmt.finalize();
        }
    });
});

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

// LOGIN
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err || !user) return res.status(403).json({ error: "Utente non trovato" });

        if (user.role === 'admin') {
            if (!bcrypt.compareSync(password, user.password)) return res.status(403).json({ error: "Password errata" });
        }
        
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY);
        res.json({ token, role: user.role, username: user.username });
    });
});

// POI ROUTES
app.get('/pois', authenticateToken, (req, res) => {
    let q = "SELECT pois.*, users.username as owner FROM pois JOIN users ON pois.user_id = users.id";
    let p = [];
    if (req.user.role !== 'admin') { q += " WHERE pois.user_id = ?"; p.push(req.user.id); }
    db.all(q, p, (err, rows) => {
        if(err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.post('/pois', authenticateToken, (req, res) => {
    const { name, lat, lng, type, note, link } = req.body;
    db.run(`INSERT INTO pois (user_id, name, lat, lng, type, note, link) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
        [req.user.id, name, lat, lng, type, note, link], function(err) { 
            if(err) return res.status(500).json({error: err.message});
            res.json({ message: "OK", id: this.lastID }); 
        });
});

app.put('/pois/:id', authenticateToken, (req, res) => {
    const { name, type, note, link } = req.body;
    db.get("SELECT user_id FROM pois WHERE id = ?", [req.params.id], (err, row) => {
       if (!row || (req.user.role !== 'admin' && row.user_id !== req.user.id)) return res.status(403).json({error: "Vietato"});
       db.run(`UPDATE pois SET name=?, type=?, note=?, link=? WHERE id=?`, [name, type, note, link, req.params.id], ()=>res.json({msg:"OK"}));
    });
});

app.delete('/pois/:id', authenticateToken, (req, res) => {
    db.get("SELECT user_id FROM pois WHERE id = ?", [req.params.id], (err, row) => {
       if (!row || (req.user.role !== 'admin' && row.user_id !== req.user.id)) return res.status(403).json({error: "Vietato"});
       db.run(`DELETE FROM pois WHERE id=?`, [req.params.id], ()=>res.json({msg:"Eliminato"}));
    });
});

app.get('/tipologie', (req, res) => {
    db.all("SELECT id as IDTipo, tipo as Tipo, colore as Colore FROM tipologie", [], (err, rows) => res.json(rows || []));
});

// ADMIN USERS
app.get('/users', authenticateToken, (req, res) => {
    if(req.user.role !== 'admin') return res.sendStatus(403);
    db.all("SELECT id, username, role FROM users", [], (err, rows) => res.json(rows));
});

app.post('/users', authenticateToken, (req, res) => {
    if(req.user.role !== 'admin') return res.sendStatus(403);
    const hash = bcrypt.hashSync('nopass', 10);
    db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, 'user')`, [req.body.username, hash], (err) => {
        if (err) return res.status(400).json({ error: "Errore o duplicato" });
        res.json({ message: "Creato" });
    });
});

app.delete('/users/:id', authenticateToken, (req, res) => {
    if(req.user.role !== 'admin') return res.sendStatus(403);
    if(parseInt(req.params.id) === req.user.id) return res.status(400).json({error: "No self-delete"});
    db.serialize(() => {
        db.run("DELETE FROM pois WHERE user_id = ?", [req.params.id]);
        db.run("DELETE FROM users WHERE id = ?", [req.params.id], ()=>res.json({msg:"Eliminato"}));
    });
});

// --- MODIFICA CRITICA PER RAILWAY ---
// Ascolta su 0.0.0.0 (tutte le interfacce) invece di localhost
app.listen(PORT, '0.0.0.0', () => {
    console.log(`SERVER AVVIATO SU PORTA ${PORT}`);
});