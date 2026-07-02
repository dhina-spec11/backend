const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const https = require('https');
const fs = require('fs');

console.log("Loaded DB Config:");
console.log("  Host:", process.env.DB_HOST);
console.log("  Port:", process.env.DB_PORT);
console.log("  User:", process.env.DB_USER);
console.log("  Name:", process.env.DB_NAME);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Create MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

// Auto-initialize tables
async function initDb() {
  try {
    const connection = await pool.getConnection();
    console.log("Connected to MySQL database successfully!");

    // Create users table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        email VARCHAR(255) PRIMARY KEY,
        password VARCHAR(255) NOT NULL,
        uid VARCHAR(255) NOT NULL
      )
    `);

    // Create forms table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS forms (
        id VARCHAR(255) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'draft',
        ownerUid VARCHAR(255),
        fields LONGTEXT,
        sharedWith LONGTEXT,
        createdAt VARCHAR(255),
        updatedAt VARCHAR(255)
      )
    `);

    // Create responses table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS responses (
        id VARCHAR(255) PRIMARY KEY,
        formId VARCHAR(255) NOT NULL,
        submittedAt VARCHAR(255),
        responseData LONGTEXT
      )
    `);

    connection.release();
    console.log("Database tables verified/created successfully!");
  } catch (error) {
    console.error("Database initialization failed:", error);
  }
}

// Call database initializer
initDb();

// ─── AUTH ROUTERS ────────────────────────────────────────────────────────────

// Sign Up
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (rows.length > 0) {
      return res.status(400).json({ error: 'User already registered. Try logging in.' });
    }
    const uid = `mock-uid-${email.replace(/[^a-zA-Z0-9]/g, '')}`;
    await pool.query('INSERT INTO users (email, password, uid) VALUES (?, ?, ?)', [email.toLowerCase(), password, uid]);
    res.json({ uid, email });
  } catch (err) {
    console.error("Sign Up Error:", err);
    res.status(500).json({ error: 'Database error occurred during Sign Up.' });
  }
});

// Sign In
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ? AND password = ?', [email.toLowerCase(), password]);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password. Hint: Sign Up first if you do not have an account.' });
    }
    const user = rows[0];
    res.json({ uid: user.uid, email: user.email });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: 'Database error occurred during login.' });
  }
});

// ─── FORMS CATALOG ROUTERS ───────────────────────────────────────────────────

// Retrieve all forms
app.get('/api/forms', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM forms');
    const forms = rows.map(row => ({
      ...row,
      fields: row.fields ? JSON.parse(row.fields) : [],
      sharedWith: row.sharedWith ? JSON.parse(row.sharedWith) : []
    }));
    res.json(forms);
  } catch (err) {
    console.error("Get Forms Error:", err);
    res.status(500).json({ error: 'Database error retrieving forms.' });
  }
});

// Retrieve a single form by ID
app.get('/api/forms/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM forms WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Form workspace not found.' });
    }
    const form = rows[0];
    res.json({
      ...form,
      fields: form.fields ? JSON.parse(form.fields) : [],
      sharedWith: form.sharedWith ? JSON.parse(form.sharedWith) : []
    });
  } catch (err) {
    console.error("Get Form Error:", err);
    res.status(500).json({ error: 'Database error retrieving form.' });
  }
});

// Save or Update a Form (Upsert)
app.post('/api/forms', async (req, res) => {
  const { id, fields, title, description, status, ownerUid } = req.body;
  try {
    const fieldsStr = JSON.stringify(fields || []);
    const sharedWithStr = JSON.stringify([]);
    const now = new Date().toISOString();

    await pool.query(`
      INSERT INTO forms (id, title, description, status, ownerUid, fields, sharedWith, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        description = VALUES(description),
        status = VALUES(status),
        fields = VALUES(fields),
        updatedAt = VALUES(updatedAt)
    `, [id, title, description, status || 'draft', ownerUid, fieldsStr, sharedWithStr, now, now]);

    res.json({ id, fields, title, description, status, ownerUid });
  } catch (err) {
    console.error("Save Form Error:", err);
    res.status(500).json({ error: 'Database error saving form schema.' });
  }
});

// Delete a form and its associated submissions
app.delete('/api/forms/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM forms WHERE id = ?', [req.params.id]);
    await pool.query('DELETE FROM responses WHERE formId = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete Form Error:", err);
    res.status(500).json({ error: 'Database error removing form.' });
  }
});

// ─── SUBMISSION / RESPONSES ROUTERS ──────────────────────────────────────────

// Log a new response entry
app.post('/api/forms/:id/responses', async (req, res) => {
  const formId = req.params.id;
  const responseData = req.body;
  const id = `resp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const submittedAt = new Date().toISOString();
  try {
    const responseDataStr = JSON.stringify(responseData);
    await pool.query(
      'INSERT INTO responses (id, formId, submittedAt, responseData) VALUES (?, ?, ?, ?)',
      [id, formId, submittedAt, responseDataStr]
    );
    res.json({ id, formId, submittedAt, ...responseData });
  } catch (err) {
    console.error("Submit Response Error:", err);
    res.status(500).json({ error: 'Database error logging response entry.' });
  }
});

// Retrieve responses for a form
app.get('/api/forms/:id/responses', async (req, res) => {
  const formId = req.params.id;
  try {
    const [rows] = await pool.query('SELECT * FROM responses WHERE formId = ?', [formId]);
    const responses = rows.map(row => ({
      id: row.id,
      formId: row.formId,
      submittedAt: row.submittedAt,
      ...JSON.parse(row.responseData)
    }));
    res.json(responses);
  } catch (err) {
    console.error("Get Responses Error:", err);
    res.status(500).json({ error: 'Database error fetching response entries.' });
  }
});

// ─── COLLABORATOR CONTROLS ───────────────────────────────────────────────────

// Add collaborator access
app.post('/api/forms/:id/collaborators', async (req, res) => {
  const formId = req.params.id;
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }
  try {
    const [rows] = await pool.query('SELECT sharedWith FROM forms WHERE id = ?', [formId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Form workspace not found.' });
    }
    let sharedWith = [];
    if (rows[0].sharedWith) {
      sharedWith = JSON.parse(rows[0].sharedWith);
    }
    const lowerEmail = email.trim().toLowerCase();
    if (!sharedWith.includes(lowerEmail)) {
      sharedWith.push(lowerEmail);
    }
    await pool.query('UPDATE forms SET sharedWith = ? WHERE id = ?', [JSON.stringify(sharedWith), formId]);
    res.json(sharedWith);
  } catch (err) {
    console.error("Add Collaborator Error:", err);
    res.status(500).json({ error: 'Database error adding collaborator.' });
  }
});

// Remove collaborator access
app.delete('/api/forms/:id/collaborators', async (req, res) => {
  const formId = req.params.id;
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }
  try {
    const [rows] = await pool.query('SELECT sharedWith FROM forms WHERE id = ?', [formId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Form workspace not found.' });
    }
    let sharedWith = [];
    if (rows[0].sharedWith) {
      sharedWith = JSON.parse(rows[0].sharedWith);
    }
    const lowerEmail = email.trim().toLowerCase();
    sharedWith = sharedWith.filter(e => e !== lowerEmail);
    await pool.query('UPDATE forms SET sharedWith = ? WHERE id = ?', [JSON.stringify(sharedWith), formId]);
    res.json(sharedWith);
  } catch (err) {
    console.error("Remove Collaborator Error:", err);
    res.status(500).json({ error: 'Database error removing collaborator.' });
  }
});

// Dynamic Local LAN IP Detection Route
app.get('/api/network-ip', (req, res) => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let ipAddress = 'localhost';

  // Sort interfaces to prioritize Wi-Fi and physical Ethernet
  const interfaceNames = Object.keys(interfaces).sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    const aIsWifi = aLower.includes('wi-fi') || aLower.includes('wifi') || aLower.includes('wireless');
    const bIsWifi = bLower.includes('wi-fi') || bLower.includes('wifi') || bLower.includes('wireless');
    if (aIsWifi && !bIsWifi) return -1;
    if (!aIsWifi && bIsWifi) return 1;

    const aIsEth = aLower.includes('ethernet');
    const bIsEth = bLower.includes('ethernet');
    if (aIsEth && !bIsEth) return -1;
    if (!aIsEth && bIsEth) return 1;

    return 0;
  });

  const virtualKeywords = ['virtual', 'vbox', 'vmware', 'vmnet', 'vethernet', 'host-only'];
  for (const interfaceName of interfaceNames) {
    const isVirtual = virtualKeywords.some(kw => interfaceName.toLowerCase().includes(kw));
    if (isVirtual) continue;

    const addresses = interfaces[interfaceName];
    for (const addressInfo of addresses) {
      if (addressInfo.family === 'IPv4' && !addressInfo.internal) {
        // Exclude common VirtualBox host-only network adapter range
        if (addressInfo.address.startsWith('192.168.56.')) continue;

        ipAddress = addressInfo.address;
        break;
      }
    }
    if (ipAddress !== 'localhost') break;
  }

  // Fallback if no physical network adapter found
  if (ipAddress === 'localhost') {
    for (const interfaceName of interfaceNames) {
      const addresses = interfaces[interfaceName];
      for (const addressInfo of addresses) {
        if (addressInfo.family === 'IPv4' && !addressInfo.internal) {
          ipAddress = addressInfo.address;
          break;
        }
      }
      if (ipAddress !== 'localhost') break;
    }
  }

  res.json({ ip: ipAddress });
});

if (process.env.USE_HTTPS === 'true') {
  try {
    const privateKey = fs.readFileSync(path.join(__dirname, 'key.pem'), 'utf8');
    const certificate = fs.readFileSync(path.join(__dirname, 'cert.pem'), 'utf8');
    const credentials = { key: privateKey, cert: certificate };

    const secureServer = https.createServer(credentials, app);
    secureServer.listen(PORT, () => {
      console.log(`Secure Server is running on https://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Error starting HTTPS server, starting HTTP fallback...", error);
    app.listen(PORT, () => {
      console.log(`HTTP Server is running on http://localhost:${PORT}`);
    });
  }
} else {
  app.listen(PORT, () => {
    console.log(`HTTP Server is running on http://localhost:${PORT}`);
  });
}
