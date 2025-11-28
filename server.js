const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;
const SECRET_KEY = "chiave_segreta_locale";

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('.'));

const db = new sqlite3.Database('./mappa_poi.db');

db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON");
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user')`);
    db.run(`CREATE TABLE IF NOT EXISTS tipologie (id INTEGER PRIMARY KEY, tipo TEXT, colore TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS pois (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, lat REAL, lng REAL, type INTEGER, note TEXT, link TEXT, FOREIGN KEY(user_id) REFERENCES users(id))`);
});

const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization'] && req.headers['authorization'].split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- LOGICA DI LOGIN MODIFICATA ---
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (!user) return res.status(403).json({ error: "Utente non trovato" });
        
        // SE È ADMIN: La password è obbligatoria e deve essere giusta
        if (user.role === 'admin') {
            if (!(await bcrypt.compare(password, user.password))) {
                return res.status(403).json({ error: "Password Admin errata" });
            }
        }
        // SE È USER: Entra senza controllare la password
        
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY);
        res.json({ token, role: user.role, username: user.username });
    });
});

// --- ROTTE POI ---
app.get('/pois', authenticateToken, (req, res) => {
    let q = "SELECT pois.*, users.username as owner FROM pois JOIN users ON pois.user_id = users.id";
    let p = [];
    if (req.user.role !== 'admin') { q += " WHERE user_id = ?"; p.push(req.user.id); }
    db.all(q, p, (err, rows) => res.json(rows));
});

app.post('/pois', authenticateToken, (req, res) => {
    const { name, lat, lng, type, note, link } = req.body;
    db.run(`INSERT INTO pois (user_id, name, lat, lng, type, note, link) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
        [req.user.id, name, lat, lng, type, note, link], function(err) { res.json({ message: "OK", id: this.lastID }); });
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

// --- GESTIONE UTENTI (Admin) ---
app.get('/users', authenticateToken, (req, res) => {
    if(req.user.role !== 'admin') return res.sendStatus(403);
    db.all("SELECT id, username, role FROM users", [], (err, rows) => res.json(rows));
});

// MODIFICATO: Creazione utente senza richiedere password
app.post('/users', authenticateToken, async (req, res) => {
    if(req.user.role !== 'admin') return res.sendStatus(403);
    const { username } = req.body; // Niente password dal body
    
    try {
        // Password finta nel DB (tanto non la controlliamo al login)
        const hash = await bcrypt.hash('nopass', 10);
        db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, 'user')`, [username, hash], (err) => {
            if (err) return res.status(400).json({ error: "Username già esistente" });
            res.json({ message: "Utente creato" });
        });
    } catch { res.status(500).send("Errore server"); }
});

app.delete('/users/:id', authenticateToken, (req, res) => {
    if(req.user.role !== 'admin') return res.sendStatus(403);
    if(parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: "Non puoi eliminarti" });
    db.serialize(() => {
        db.run("DELETE FROM pois WHERE user_id = ?", [req.params.id]);
        db.run("DELETE FROM users WHERE id = ?", [req.params.id], (err) => {
            if(err) return res.status(500).json({ error: "Errore" });
            res.json({ message: "Eliminato" });
        });
    });
});

app.listen(PORT, () => console.log(`Server attivo: http://localhost:${PORT}`));