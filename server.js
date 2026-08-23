// Trigger server reload
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: ['https://satvikrecord.vercel.app', 'http://localhost:5173'],
  credentials: true
}));
app.use(express.json());

// Database configuration state
let useLocalJSON = false;
const JSON_DB_FILE = './database.json';

// Local JSON Database Helper Functions
function readLocalDB() {
    if (!fs.existsSync(JSON_DB_FILE)) {
        return { entries: {}, configs: {} };
    }
    try {
        const raw = fs.readFileSync(JSON_DB_FILE, 'utf8');
        return JSON.parse(raw) || { entries: {}, configs: {} };
    } catch (e) {
        console.error('Error reading database.json, returning empty structure.', e);
        return { entries: {}, configs: {} };
    }
}

function writeLocalDB(data) {
    try {
        fs.writeFileSync(JSON_DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Error writing to database.json', e);
    }
}

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/doodh-record';
mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
      console.log('Connected to MongoDB database successfully.');
      useLocalJSON = false;
  })
  .catch(err => {
      console.error('\n=========================================');
      console.error('MongoDB Connection Error:', err.message);
      console.error('--> FALLING BACK TO LOCAL FILE STORAGE (database.json)');
      console.error('All data will be saved locally in the project folder.');
      console.error('=========================================\n');
      useLocalJSON = true;
  });

// Schemas & Models (Used when MongoDB connects)
const EntrySchema = new mongoose.Schema({
    date: { type: String, required: true, unique: true }, // Format: YYYY-MM-DD
    morning: { type: Number, default: 0 },
    evening: { type: Number, default: 0 }
});

const MonthConfigSchema = new mongoose.Schema({
    month: { type: String, required: true, unique: true }, // Format: YYYY-MM
    rate: { type: Number, default: 0 },
    notes: { type: String, default: '' }
});

const Entry = mongoose.model('Entry', EntrySchema);
const MonthConfig = mongoose.model('MonthConfig', MonthConfigSchema);

// API Endpoints

// 1. Fetch entries for a specific month (filter by YYYY-MM prefix)
app.get('/api/entries/:month', async (req, res) => {
    const month = req.params.month;
    
    if (useLocalJSON) {
        const db = readLocalDB();
        const matching = Object.keys(db.entries)
            .filter(date => date.startsWith(month))
            .map(date => ({ date, ...db.entries[date] }));
        return res.json(matching);
    }

    try {
        const entries = await Entry.find({ date: new RegExp('^' + month) });
        res.json(entries);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Add or update daily entry
app.post('/api/entries', async (req, res) => {
    const { date, shift, quantity } = req.body;
    
    if (!date || !shift || quantity === undefined) {
        return res.status(400).json({ error: 'Date, shift and quantity are required.' });
    }

    const parsedQty = parseFloat(quantity) || 0;

    if (useLocalJSON) {
        const db = readLocalDB();
        if (!db.entries[date]) {
            db.entries[date] = { morning: 0, evening: 0 };
        }
        db.entries[date][shift] = parsedQty;

        if (db.entries[date].morning === 0 && db.entries[date].evening === 0) {
            delete db.entries[date];
            writeLocalDB(db);
            return res.json({ message: 'Entry deleted because both shifts are zero.', deleted: true });
        }

        writeLocalDB(db);
        return res.json({ date, ...db.entries[date] });
    }

    try {
        let entry = await Entry.findOne({ date });
        if (!entry) {
            entry = new Entry({ date, morning: 0, evening: 0 });
        }

        entry[shift] = parsedQty;

        if (entry.morning === 0 && entry.evening === 0) {
            await Entry.deleteOne({ date });
            return res.json({ message: 'Entry deleted because both shifts are zero.', deleted: true });
        }

        await entry.save();
        res.json(entry);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Edit multiple shifts in a single call (edit modal)
app.post('/api/entries/edit', async (req, res) => {
    const { date, morning, evening } = req.body;
    
    if (!date) {
        return res.status(400).json({ error: 'Date is required.' });
    }

    const morningVal = parseFloat(morning) || 0;
    const eveningVal = parseFloat(evening) || 0;

    if (useLocalJSON) {
        const db = readLocalDB();
        if (morningVal === 0 && eveningVal === 0) {
            delete db.entries[date];
            writeLocalDB(db);
            return res.json({ message: 'Entry deleted.', deleted: true });
        }

        db.entries[date] = { morning: morningVal, evening: eveningVal };
        writeLocalDB(db);
        return res.json({ date, ...db.entries[date] });
    }

    try {
        if (morningVal === 0 && eveningVal === 0) {
            await Entry.deleteOne({ date });
            return res.json({ message: 'Entry deleted.', deleted: true });
        }

        let entry = await Entry.findOne({ date });
        if (!entry) {
            entry = new Entry({ date });
        }

        entry.morning = morningVal;
        entry.evening = eveningVal;
        
        await entry.save();
        res.json(entry);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Delete entry
app.delete('/api/entries/:date', async (req, res) => {
    const dateStr = req.params.date;

    if (useLocalJSON) {
        const db = readLocalDB();
        if (db.entries[dateStr]) {
            delete db.entries[dateStr];
            writeLocalDB(db);
            return res.json({ success: true, deletedCount: 1 });
        }
        return res.json({ success: true, deletedCount: 0 });
    }

    try {
        const result = await Entry.deleteOne({ date: dateStr });
        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Fetch rate and notes config for a month
app.get('/api/month-config/:month', async (req, res) => {
    const month = req.params.month;

    if (useLocalJSON) {
        const db = readLocalDB();
        return res.json(db.configs[month] || { month, rate: 0, notes: '' });
    }

    try {
        const config = await MonthConfig.findOne({ month });
        res.json(config || { month, rate: 0, notes: '' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Save/update rate and notes config for a month
app.post('/api/month-config', async (req, res) => {
    const { month, rate, notes } = req.body;
    
    if (!month) {
        return res.status(400).json({ error: 'Month (YYYY-MM) is required.' });
    }

    if (useLocalJSON) {
        const db = readLocalDB();
        if (!db.configs[month]) {
            db.configs[month] = { month, rate: 0, notes: '' };
        }
        if (rate !== undefined) db.configs[month].rate = parseFloat(rate) || 0;
        if (notes !== undefined) db.configs[month].notes = notes;

        writeLocalDB(db);
        return res.json(db.configs[month]);
    }

    try {
        let config = await MonthConfig.findOne({ month });
        if (!config) {
            config = new MonthConfig({ month, rate: 0, notes: '' });
        }

        if (rate !== undefined) config.rate = parseFloat(rate) || 0;
        if (notes !== undefined) config.notes = notes;

        await config.save();
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. Export monthly entries as CSV file
app.get('/api/export/:month', async (req, res) => {
    try {
        const month = req.params.month;
        let entriesList = [];
        let config = { rate: 0, notes: '' };

        if (useLocalJSON) {
            const db = readLocalDB();
            config = db.configs[month] || { rate: 0, notes: '' };
            entriesList = Object.keys(db.entries)
                .filter(date => date.startsWith(month))
                .map(date => ({ date, ...db.entries[date] }))
                .sort((a, b) => a.date.localeCompare(b.date));
        } else {
            entriesList = await Entry.find({ date: new RegExp('^' + month) }).sort({ date: 1 });
            config = await MonthConfig.findOne({ month }) || { rate: 0, notes: '' };
        }

        const rate = config.rate || 0;
        let csv = 'Date,Day,Morning Qty (Litre),Evening Qty (Litre),Daily Total (Litre),Rate (Rs/Litre),Amount (Rs)\n';
        
        let grandTotalLitres = 0;
        entriesList.forEach(e => {
            const dateParts = e.date.split('-');
            const dObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
            const dayName = dObj.toLocaleDateString('en-IN', { weekday: 'short' });
            const total = e.morning + e.evening;
            const amt = total * rate;
            grandTotalLitres += total;
            
            csv += `${e.date},${dayName},${e.morning},${e.evening},${total.toFixed(1)},${rate},${amt.toFixed(2)}\n`;
        });
        
        // Grand totals row
        csv += `\n`;
        csv += `GRAND TOTAL,,,Total Litres,${grandTotalLitres.toFixed(1)},Rate,${rate}\n`;
        csv += `,,,Total Amount (Rs),${(grandTotalLitres * rate).toFixed(2)},,\n`;
        
        if (config.notes) {
            const escapedNotes = config.notes.replace(/"/g, '""').replace(/\n/g, ' ');
            csv += `\nNotes:,"${escapedNotes}"\n`;
        }
        
        // Send file response
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=doodh-record-${month}.csv`);
        res.status(200).send(csv);
    } catch (err) {
        res.status(500).send('Error generating export file: ' + err.message);
    }
});

// Serve frontend static build files (for single build deployments)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, 'dist');

app.use(express.static(distPath));

// Fallback to React App Router
app.get('*', (req, res, next) => {
    if (req.url.startsWith('/api')) {
        return next();
    }
    res.sendFile(path.join(distPath, 'index.html'), (err) => {
        if (err) {
            res.status(200).json({ 
                status: 'Backend running, static dist files not built yet',
                mode: useLocalJSON ? 'Local File DB Mode (database.json)' : 'MongoDB Database Mode'
            });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
