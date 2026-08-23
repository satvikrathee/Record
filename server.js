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
        // Initialize with default 10 persons
        const db = {
            persons: Array.from({ length: 10 }, (_, i) => ({ personId: String(i + 1), name: `Cow ${i + 1}` })),
            entries: [],
            configs: []
        };
        writeLocalDB(db);
        return db;
    }
    try {
        const raw = fs.readFileSync(JSON_DB_FILE, 'utf8');
        const data = JSON.parse(raw) || {};
        if (!data.persons) data.persons = Array.from({ length: 10 }, (_, i) => ({ personId: String(i + 1), name: `Cow ${i + 1}` }));
        
        // Migration for local file:
        data.persons = data.persons.map(p => {
            if (p.name && p.name.startsWith('Person ')) {
                p.name = p.name.replace('Person ', 'Cow ');
            }
            return p;
        });

        if (!data.entries) data.entries = [];
        if (!data.configs) data.configs = [];
        return data;
    } catch (e) {
        console.error('Error reading database.json, returning empty structure.', e);
        return {
            persons: Array.from({ length: 10 }, (_, i) => ({ personId: String(i + 1), name: `Cow ${i + 1}` })),
            entries: [],
            configs: []
        };
    }
}

function writeLocalDB(data) {
    try {
        fs.writeFileSync(JSON_DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Error writing to database.json', e);
    }
}

// Schemas & Models
const PersonSchema = new mongoose.Schema({
    personId: { type: String, required: true, unique: true },
    name: { type: String, required: true }
});

const EntrySchema = new mongoose.Schema({
    date: { type: String, required: true }, // Format: YYYY-MM-DD
    personId: { type: String, required: true, default: '1' },
    morning: { type: Number, default: 0 },
    evening: { type: Number, default: 0 }
});
// Compound index to ensure uniqueness of entries per person per date
EntrySchema.index({ date: 1, personId: 1 }, { unique: true });

const MonthConfigSchema = new mongoose.Schema({
    month: { type: String, required: true }, // Format: YYYY-MM
    personId: { type: String, required: true, default: '1' },
    rate: { type: Number, default: 0 },
    notes: { type: String, default: '' }
});
// Compound index to ensure uniqueness of rates/notes per person per month
MonthConfigSchema.index({ month: 1, personId: 1 }, { unique: true });

const Person = mongoose.model('Person', PersonSchema);
const Entry = mongoose.model('Entry', EntrySchema);
const MonthConfig = mongoose.model('MonthConfig', MonthConfigSchema);

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/doodh-record';
mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(async () => {
      console.log('Connected to MongoDB database successfully.');
      useLocalJSON = false;
      
      // Seed default cows if collection is empty
      try {
          // Migration check: rename any existing "Person X" names to "Cow X"
          const existingPersons = await Person.find();
          for (let p of existingPersons) {
              if (p.name && p.name.startsWith('Person ')) {
                  p.name = p.name.replace('Person ', 'Cow ');
                  await p.save();
              }
          }

          const count = await Person.countDocuments();
          if (count === 0) {
              const defaultCows = Array.from({ length: 10 }, (_, i) => ({
                  personId: String(i + 1),
                  name: `Cow ${i + 1}`
              }));
              await Person.insertMany(defaultCows);
              console.log('Seeded 10 default cows successfully.');
          }
      } catch (err) {
          console.error('Error migrating or seeding default cows:', err.message);
      }
  })
  .catch(err => {
      console.error('\n=========================================');
      console.error('MongoDB Connection Error:', err.message);
      console.error('--> FALLING BACK TO LOCAL FILE STORAGE (database.json)');
      console.error('All data will be saved locally in the project folder.');
      console.error('=========================================\n');
      useLocalJSON = true;
  });

// API Endpoints

// 1. Fetch all persons
app.get('/api/persons', async (req, res) => {
    if (useLocalJSON) {
        const db = readLocalDB();
        return res.json(db.persons);
    }
    try {
        const persons = await Person.find().sort({ personId: 1 });
        res.json(persons);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 1.5 Add a new cow profile
app.post('/api/persons', async (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Name is required.' });
    }
    const id = 'cow-' + Date.now();
    if (useLocalJSON) {
        const db = readLocalDB();
        const newCow = { personId: id, name };
        db.persons.push(newCow);
        writeLocalDB(db);
        return res.json(newCow);
    }
    try {
        const newCow = new Person({ personId: id, name });
        await newCow.save();
        res.json(newCow);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Rename person profile
app.post('/api/persons/rename', async (req, res) => {
    const { personId, name } = req.body;
    if (!personId || !name) {
        return res.status(400).json({ error: 'personId and name are required.' });
    }
    if (useLocalJSON) {
        const db = readLocalDB();
        const idx = db.persons.findIndex(p => p.personId === personId);
        if (idx !== -1) {
            db.persons[idx].name = name;
            writeLocalDB(db);
            return res.json(db.persons[idx]);
        }
        return res.status(404).json({ error: 'Person profile not found.' });
    }
    try {
        const p = await Person.findOneAndUpdate({ personId }, { name }, { new: true });
        res.json(p);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Delete cow profile
app.delete('/api/persons/:personId', async (req, res) => {
    const { personId } = req.params;
    if (useLocalJSON) {
        const db = readLocalDB();
        db.persons = db.persons.filter(p => p.personId !== personId);
        db.configs = db.configs.filter(c => c.personId !== personId);
        writeLocalDB(db);
        return res.json({ success: true });
    }
    try {
        await Person.deleteOne({ personId });
        await MonthConfig.deleteMany({ personId });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Fetch entries for a specific month and personId
app.get('/api/entries/:month', async (req, res) => {
    const month = req.params.month;
    const personId = req.query.personId || '1';
    
    if (useLocalJSON) {
        const db = readLocalDB();
        const matching = db.entries.filter(e => e.personId === personId && e.date.startsWith(month));
        return res.json(matching);
    }

    try {
        const entries = await Entry.find({ personId, date: new RegExp('^' + month) });
        res.json(entries);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Add or update daily entry
app.post('/api/entries', async (req, res) => {
    const { date, shift, quantity, personId = '1' } = req.body;
    
    if (!date || !shift || quantity === undefined) {
        return res.status(400).json({ error: 'Date, shift and quantity are required.' });
    }

    const parsedQty = parseFloat(quantity) || 0;

    if (useLocalJSON) {
        const db = readLocalDB();
        let entryIdx = db.entries.findIndex(e => e.date === date && e.personId === personId);
        if (entryIdx === -1) {
            db.entries.push({ date, personId, morning: 0, evening: 0 });
            entryIdx = db.entries.length - 1;
        }
        db.entries[entryIdx][shift] = parsedQty;

        if (db.entries[entryIdx].morning === 0 && db.entries[entryIdx].evening === 0) {
            db.entries.splice(entryIdx, 1);
            writeLocalDB(db);
            return res.json({ message: 'Entry deleted because both shifts are zero.', deleted: true });
        }

        writeLocalDB(db);
        return res.json(db.entries[entryIdx]);
    }

    try {
        let entry = await Entry.findOne({ date, personId });
        if (!entry) {
            entry = new Entry({ date, personId, morning: 0, evening: 0 });
        }

        entry[shift] = parsedQty;

        if (entry.morning === 0 && entry.evening === 0) {
            await Entry.deleteOne({ date, personId });
            return res.json({ message: 'Entry deleted because both shifts are zero.', deleted: true });
        }

        await entry.save();
        res.json(entry);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Edit multiple shifts in a single call (edit modal)
app.post('/api/entries/edit', async (req, res) => {
    const { date, morning, evening, personId = '1' } = req.body;
    
    if (!date) {
        return res.status(400).json({ error: 'Date is required.' });
    }

    const morningVal = parseFloat(morning) || 0;
    const eveningVal = parseFloat(evening) || 0;

    if (useLocalJSON) {
        const db = readLocalDB();
        let entryIdx = db.entries.findIndex(e => e.date === date && e.personId === personId);
        
        if (morningVal === 0 && eveningVal === 0) {
            if (entryIdx !== -1) {
                db.entries.splice(entryIdx, 1);
                writeLocalDB(db);
            }
            return res.json({ message: 'Entry deleted.', deleted: true });
        }

        if (entryIdx === -1) {
            db.entries.push({ date, personId, morning: morningVal, evening: eveningVal });
        } else {
            db.entries[entryIdx].morning = morningVal;
            db.entries[entryIdx].evening = eveningVal;
        }
        
        writeLocalDB(db);
        return res.json(entryIdx === -1 ? db.entries[db.entries.length - 1] : db.entries[entryIdx]);
    }

    try {
        if (morningVal === 0 && eveningVal === 0) {
            await Entry.deleteOne({ date, personId });
            return res.json({ message: 'Entry deleted.', deleted: true });
        }

        let entry = await Entry.findOne({ date, personId });
        if (!entry) {
            entry = new Entry({ date, personId });
        }

        entry.morning = morningVal;
        entry.evening = eveningVal;
        
        await entry.save();
        res.json(entry);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Delete entry
app.delete('/api/entries/:date', async (req, res) => {
    const dateStr = req.params.date;
    const personId = req.query.personId || '1';

    if (useLocalJSON) {
        const db = readLocalDB();
        const beforeCount = db.entries.length;
        db.entries = db.entries.filter(e => !(e.date === dateStr && e.personId === personId));
        writeLocalDB(db);
        return res.json({ success: true, deletedCount: beforeCount - db.entries.length });
    }

    try {
        const result = await Entry.deleteOne({ date: dateStr, personId });
        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. Fetch rate and notes config for a month
app.get('/api/month-config/:month', async (req, res) => {
    const month = req.params.month;
    const personId = req.query.personId || '1';

    if (useLocalJSON) {
        const db = readLocalDB();
        const config = db.configs.find(c => c.month === month && c.personId === personId);
        return res.json(config || { month, personId, rate: 0, notes: '' });
    }

    try {
        const config = await MonthConfig.findOne({ month, personId });
        res.json(config || { month, personId, rate: 0, notes: '' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7.5 Fetch rate and notes config for all cows for a month
app.get('/api/month-configs-all/:month', async (req, res) => {
    const month = req.params.month;

    if (useLocalJSON) {
        const db = readLocalDB();
        const configs = db.configs.filter(c => c.month === month);
        return res.json(configs);
    }

    try {
        const configs = await MonthConfig.find({ month });
        res.json(configs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// 8. Save/update rate and notes config for a month
app.post('/api/month-config', async (req, res) => {
    const { month, rate, notes, personId = '1' } = req.body;
    
    if (!month) {
        return res.status(400).json({ error: 'Month (YYYY-MM) is required.' });
    }

    if (useLocalJSON) {
        const db = readLocalDB();
        let configIdx = db.configs.findIndex(c => c.month === month && c.personId === personId);
        if (configIdx === -1) {
            db.configs.push({ month, personId, rate: 0, notes: '' });
            configIdx = db.configs.length - 1;
        }
        if (rate !== undefined) db.configs[configIdx].rate = parseFloat(rate) || 0;
        if (notes !== undefined) db.configs[configIdx].notes = notes;

        writeLocalDB(db);
        return res.json(db.configs[configIdx]);
    }

    try {
        let config = await MonthConfig.findOne({ month, personId });
        if (!config) {
            config = new MonthConfig({ month, personId, rate: 0, notes: '' });
        }

        if (rate !== undefined) config.rate = parseFloat(rate) || 0;
        if (notes !== undefined) config.notes = notes;

        await config.save();
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9. Export monthly entries as CSV file
app.get('/api/export/:month', async (req, res) => {
    try {
        const month = req.params.month;
        const personId = req.query.personId || '1';
        let entriesList = [];
        let config = { rate: 0, notes: '' };
        let personName = 'Person ' + personId;

        if (useLocalJSON) {
            const db = readLocalDB();
            config = db.configs.find(c => c.month === month && c.personId === personId) || { rate: 0, notes: '' };
            entriesList = db.entries.filter(e => e.personId === personId && e.date.startsWith(month))
                .sort((a, b) => a.date.localeCompare(b.date));
            const p = db.persons.find(x => x.personId === personId);
            if (p) personName = p.name;
        } else {
            entriesList = await Entry.find({ personId, date: new RegExp('^' + month) }).sort({ date: 1 });
            config = await MonthConfig.findOne({ month, personId }) || { rate: 0, notes: '' };
            const p = await Person.findOne({ personId });
            if (p) personName = p.name;
        }

        const rate = config.rate || 0;
        let csv = `SATVIK DAIRY TRACK REPORT FOR COW: ${personName.toUpperCase()}\n`;
        csv += `Month: ${month}\n\n`;
        csv += 'Date,Day,Morning Qty (Litre),Evening Qty (Litre),Daily Total (Litre),Rate (Rs/Litre),Amount (Rs)\n';
        
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
        res.setHeader('Content-Disposition', `attachment; filename=satvik-dairy-track-${personName.replace(/\s+/g, '_')}-${month}.csv`);
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
