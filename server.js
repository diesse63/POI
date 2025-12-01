const express = require('express');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// --- CONFIGURAZIONE FIREBASE ---
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
// -------------------------------

const PORT = process.env.PORT || 3000; 
const SECRET_KEY = "chiave_segreta_locale_super_sicura";

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '.')));

// --- INIZIALIZZAZIONE DATI ---
async function initData() {
    try {
        // Crea Admin se non esiste
        const usersSnap = await db.collection('users').limit(1).get();
        if (usersSnap.empty) {
            console.log("Creazione Admin...");
            const hash = bcrypt.hashSync('admin', 10);
            await db.collection('users').add({ username: 'admin', password: hash, role: 'admin' });
        }
        
        // Crea Tipologie se non esistono
        // NOTA: Se le tipologie esistono già su Firebase, questo blocco viene saltato!
        const tipoSnap = await db.collection('tipologie').limit(1).get();
        if (tipoSnap.empty) {
            console.log("Creazione Tipologie...");
            const batch = db.batch();
            const defaults = [
                { id: 1, tipo: "Monumento", colore: "blue" },
                { id: 2, tipo: "Parco", colore: "green" },
                { id: 3, tipo: "Museo", colore: "purple" },
                { id: 4, tipo: "Ristorante", colore: "orange" },
                { id: 5, tipo: "Paese/Via/Piazza", colore: "red" }, // <--- ORA C'È LA VIRGOLA
                { id: 6, tipo: "Mercato", colore: "black" },
                { id: 7, tipo: "Chiesa", colore: "pink" },
                { id: 8, tipo: "Paese/Via/Piazza", colore: "cyan" },
                { id: 9, tipo: "Albergo", colore: "yellow" }    // <--- NUOVA CATEGORIA
            ];
            defaults.forEach(d => {
                const docRef = db.collection('tipologie').doc(d.id.toString());
                batch.set(docRef, { Tipo: d.tipo, Colore: d.colore, IDTipo: d.id });
            });
            await batch.commit();
        }
    } catch (error) { console.error("Errore init:", error); }
}
initData();

// --- MIDDLEWARE ---
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

// --- LOGIN ---
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const snapshot = await db.collection('users').where('username', '==', username).get();
        if (snapshot.empty) return res.status(403).json({ error: "Utente non trovato" });
        const doc = snapshot.docs[0];
        const user = doc.data();
        if (user.role === 'admin' && !bcrypt.compareSync(password, user.password)) 
            return res.status(403).json({ error: "Password errata" });
        
        const token = jwt.sign({ id: doc.id, username: user.username, role: user.role }, SECRET_KEY);
        res.json({ token, role: user.role, username: user.username });
    } catch(e) { res.status(500).json({error: e.message}); }
});

// --- POI ROUTES ---
app.get('/pois', authenticateToken, async (req, res) => {
    try {
        let query = db.collection('pois');
        if (req.user.role !== 'admin') query = query.where('user_id', '==', req.user.id);
        const snapshot = await query.get();
        res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/pois', authenticateToken, async (req, res) => {
    try {
        const { name, lat, lng, type, note, link } = req.body;
        const newPoi = {
            user_id: req.user.id, owner: req.user.username,
            name, lat, lng, type, note, link,
            created_at: admin.firestore.FieldValue.serverTimestamp()
        };
        const docRef = await db.collection('pois').add(newPoi);
        res.json({ message: "OK", id: docRef.id });
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.put('/pois/:id', authenticateToken, async (req, res) => {
    try {
        const docRef = db.collection('pois').doc(req.params.id);
        const { name, type, note, link } = req.body;
        await docRef.update({ name, type, note, link });
        res.json({msg:"OK"});
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.delete('/pois/:id', authenticateToken, async (req, res) => {
    try {
        await db.collection('pois').doc(req.params.id).delete();
        res.json({msg:"Eliminato"});
    } catch(e) { res.status(500).json({error: e.message}); }
});

// --- UTILITIES ---
app.get('/tipologie', async (req, res) => {
    try {
        const snapshot = await db.collection('tipologie').get();
        const list = snapshot.docs.map(doc => doc.data());
        list.sort((a,b) => a.IDTipo - b.IDTipo);
        res.json(list);
    } catch(e) { res.json([]); }
});

app.get('/users', authenticateToken, async (req, res) => {
    if(req.user.role !== 'admin') return res.sendStatus(403);
    const snap = await db.collection('users').get();
    res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
});

app.post('/users', authenticateToken, async (req, res) => {
    if(req.user.role !== 'admin') return res.sendStatus(403);
    const hash = bcrypt.hashSync('nopass', 10);
    await db.collection('users').add({ username: req.body.username, password: hash, role: 'user' });
    res.json({ message: "Creato" });
});

app.delete('/users/:id', authenticateToken, async (req, res) => {
    if(req.user.role !== 'admin') return res.sendStatus(403);
    if(req.params.id === req.user.id) return res.status(400).json({error: "No self-delete"});
    await db.collection('users').doc(req.params.id).delete();
    const poisSnap = await db.collection('pois').where('user_id', '==', req.params.id).get();
    const batch = db.batch();
    poisSnap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    res.json({msg:"Eliminato"});
});

// AVVIO
app.listen(PORT, '0.0.0.0', () => {
    console.log(`SERVER FIREBASE AVVIATO SU PORTA ${PORT}`);
});