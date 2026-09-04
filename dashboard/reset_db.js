const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(__dirname, 'database.sqlite'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
  DELETE FROM telemetry_history;
  UPDATE motors 
  SET current = 0, voltage = 0, capacitance = 0, power = 0, pf = 0, error = 0, motor_status = 'OFF', status = 'OFF';
`);
console.log('Database reset to empty state');
