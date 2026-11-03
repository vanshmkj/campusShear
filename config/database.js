const mysql = require('mysql2/promise');

function createPool(settings) {
  return mysql.createPool(settings.mysql);
}

module.exports = { createPool };
