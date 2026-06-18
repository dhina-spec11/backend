const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

async function viewDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  console.log("=== USERS IN DATABASE ===");
  const [users] = await connection.query('SELECT * FROM users');
  console.table(users);

  console.log("\n=== FORMS IN DATABASE ===");
  const [forms] = await connection.query('SELECT id, title, status, ownerUid FROM forms');
  console.table(forms);

  console.log("\n=== SUBMISSIONS IN DATABASE ===");
  const [responses] = await connection.query('SELECT id, formId, submittedAt, responseData FROM responses');
  console.table(responses.map(r => ({
    id: r.id,
    formId: r.formId,
    submittedAt: r.submittedAt,
    data: JSON.parse(r.responseData)
  })));

  await connection.end();
}

viewDatabase().catch(console.error);
