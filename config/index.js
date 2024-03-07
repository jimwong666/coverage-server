const YAML = require('yamljs');
const fs = require('fs');
const { resolve } = require('path');

// 账号数组
const getConfig = (filename) => {
  filename = filename || resolve(__dirname, './config.yml');
  return YAML.parse(fs.readFileSync(filename).toString());
};

module.exports = { getConfig };
