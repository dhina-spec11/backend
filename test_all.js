const mysql = require('mysql2/promise');

async function test(host, port, password) {
  console.log(`Trying host=${host}, port=${port}, password=${password}...`);
  try {
    const connection = await mysql.createConnection({
      host,
      port,
      user: 'root',
      password,
      database: 'railway'
    });
    console.log("SUCCESS!");
    await connection.end();
    return true;
  } catch (err) {
    console.log("FAILED:", err.message);
    return false;
  }
}

async function run() {
  const hosts = ['thomas.proxy.rlwy.net'];
  const ports = [41432];
  const passwords = [
    'BpwzQEIqgNKZsOJkuxddaEVbBNgEsDSG',
    'GzgaDWCjztxOetGVwCpHTAmBzPLMldqT'
  ];

  for (const host of hosts) {
    for (const port of ports) {
      for (const pwd of passwords) {
        const ok = await test(host, port, pwd);
        if (ok) {
          console.log(`Workable credentials: Host=${host}, Port=${port}, Pwd=${pwd}`);
          process.exit(0);
        }
      }
    }
  }
  console.log("All combinations failed.");
}

run();
