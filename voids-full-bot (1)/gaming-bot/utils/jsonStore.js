const fs = require('fs');
const path = require('path');

// Tiny JSON-file store. Lives in the same data folder as the other managers
// (DATA_DIR, default /app/data) and writes safely (temp file, then rename).
const DATA_DIR = process.env.DATA_DIR || '/app/data';

function createStore(fileName, defaultValue = {}) {
  const filePath = path.join(DATA_DIR, fileName);

  function ensure() {
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
    }
  }

  function readAll() {
    ensure();
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return structuredClone(defaultValue);
    }
  }

  function writeAll(data) {
    ensure();
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  }

  return {
    get(key) {
      const value = readAll()[key];
      return value === undefined ? structuredClone(defaultValue[key]) : value;
    },
    set(key, value) {
      const data = readAll();
      data[key] = value;
      writeAll(data);
    },
    delete(key) {
      const data = readAll();
      delete data[key];
      writeAll(data);
    },
    all() {
      return readAll();
    },
    overwriteAll(data) {
      writeAll(data);
    },
  };
}

module.exports = createStore;
