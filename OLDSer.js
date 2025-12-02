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
        console.log("Controllo Admin...");
        const adminSnap = await db.collection('users').where('username', '==', 'admin').get();
        
        // Generiamo l'hash per la NUOVA password
        const newHash = bcrypt.hashSync('admin123', 10); 

        if (adminSnap.empty) {
            // CASO 1: Admin non esiste -> Lo creiamo
            console.log("Admin non trovato: Creazione in corso...");
            await db.collection('users').add({
                username: 'admin',
                password: newHash,
                role: 'admin'
            });
            console.log("Utente Admin creato (Pass: admin123)");
        } else {
            // CASO 2: Admin esiste già -> Aggiorniamo la password!
            console.log("Admin trovato: Aggiornamento password a 'admin123'...");
            const docId = adminSnap.docs[0].id;
            await db.collection('users').doc(docId).update({
                password: newHash
            });
            console.log("Password Admin aggiornata con successo.");
        }

        // Controllo Tipologie
        const tipoSnap = await db.collection('tipologie').limit(1).get();
        if (tipoSnap.empty) {
            console.log("Creazione Tipologie...");
            const batch = db.batch();
            const defaults = [
                { id: 1, tipo: "Generico", colore: "blue" },
                { id: 2, tipo: "Natura", colore: "green" },
                { id: 3, tipo: "Cultura", colore: "purple" },
                { id: 4, tipo: "Servizi", colore: "orange" },
                { id: 5, tipo: "Ristorazione", colore: "red" },
                { id: 6, tipo: "Albergo", colore: "yellow" }
            ];
            defaults.forEach(d => {
                const docRef = db.collection('tipologie').doc(d.id.toString());
                batch.set(docRef, { Tipo: d.tipo, Colore: d.colore, IDTipo: d.id });
            });
            await batch.commit();
        }
    } catch (error) {
        console.error("Errore inizializzazione:", error);
    }
}
initData();

// --- MIDDLEWARE AUTH ---
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
        const userId = doc.id;

        if (user.role === 'admin') {
            if (!bcrypt.compareSync(password, user.password)) {
                return res.status(403).json({ error: "Password errata" });
            }
        }
        
        const token = jwt.sign({ id: userId, username: user.username, role: user.role }, SECRET_KEY);
        res.json({ token, role: user.role, username: user.username });
    } catch(e) { res.status(500).json({error: e.message}); }
});

// --- POI ROUTES ---
app.get('/pois', authenticateToken, async (req, res) => {
    try {
        let query = db.collection('pois');
        if (req.user.role !== 'admin') {
            query = query.where('user_id', '==', req.user.id);
        }
        const snapshot = await query.get();
        const pois = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(pois);
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/pois', authenticateToken, async (req, res) => {
    try {
        const { name, lat, lng, type, note, link } = req.body;
        const newPoi = {
            user_id: req.user.id,
            owner: req.user.username,
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
        const doc = await docRef.get();
        if (!doc.exists) return res.status(404).json({error: "Non trovato"});
        
        const data = doc.data();
        if (req.user.role !== 'admin' && data.user_id !== req.user.id) {
            return res.status(403).json({error: "Vietato"});
        }

        const { name, type, note, link } = req.body;
        await docRef.update({ name, type, note, link });
        res.json({msg:"OK"});
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.delete('/pois/:id', authenticateToken, async (req, res) => {
    try {
        const docRef = db.collection('pois').doc(req.params.id);
        const doc = await docRef.get();
        if (!doc.exists) return res.status(404).json({error: "Non trovato"});

        const data = doc.data();
        if (req.user.role !== 'admin' && data.user_id !== req.user.id) {
            return res.status(403).json({error: "Vietato"});
        }

        await docRef.delete();
        res.json({msg:"Eliminato"});
    } catch(e) { res.status(500).json({error: e.message}); }
});

// --- TIPOLOGIE ---
app.get('/tipologie', async (req, res) => {
    try {
        const snapshot = await db.collection('tipologie').get();
        const list = snapshot.docs.map(doc => doc.data());
        list.sort((a,b) => a.IDTipo - b.IDTipo);
        res.json(list);
    } catch(e) { res.json([]); }
});

// --- ADMIN USERS ---
app.get('/users', authenticateToken, async (req, res) => {
    if(req.user.role !== 'admin') return res.sendStatus(403);
    const snap = await db.collection('users').get();
    const users = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(users);
});

app.post('/users', authenticateToken, async (req, res) => {
    if(req.user.role !== 'admin') return res.sendStatus(403);
    const hash = bcrypt.hashSync('nopass', 10);
    await db.collection('users').add({
        username: req.body.username,
        password: hash,
        role: 'user'
    });
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

// --- FIX PER RAILWAY ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`SERVER FIREBASE AVVIATO SU PORTA ${PORT}`);
});