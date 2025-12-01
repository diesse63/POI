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
    db.get(`SELECT * F