const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

const defaultNycOptions = {
  reporter: ['json', 'json-summary', 'html'],
  extension: ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx'],
  excludeAfterRemap: true,
};

function readNycOptions(workingDirectory) {
  const pkgFilename = join(workingDirectory, 'package.json');
  const pkg = existsSync(pkgFilename) ? JSON.parse(readFileSync(pkgFilename, 'utf8')) : {};
  const pkgNycOptions = pkg.nyc || {};

  const nycrcFilename = join(workingDirectory, '.nycrc');
  const nycrc = existsSync(nycrcFilename) ? JSON.parse(readFileSync(nycrcFilename, 'utf8')) : {};

  const nycrcJsonFilename = join(workingDirectory, '.nycrc.json');
  const nycrcJson = existsSync(nycrcJsonFilename) ? JSON.parse(readFileSync(nycrcJsonFilename, 'utf8')) : {};

  let nycOptions;
  nycOptions = combineNycOptions({
    pkgNycOptions,
    nycrc,
    nycrcJson,
    defaultNycOptions,
  });
  // debug('combined NYC options %o', nycOptions);

  return nycOptions;
}

function combineNycOptions({ pkgNycOptions, nycrc, nycrcJson, defaultNycOptions }) {
  // last option wins
  const nycOptions = Object.assign({}, defaultNycOptions, nycrc, nycrcJson, pkgNycOptions);

  if (typeof nycOptions.reporter === 'string') {
    nycOptions.reporter = [nycOptions.reporter];
  }
  if (typeof nycOptions.extension === 'string') {
    nycOptions.extension = [nycOptions.extension];
  }

  return nycOptions;
}

const getFormatTime = (date) => {
  var date1 = new Date(date); //获取当前系统时间
  var year = date1.getFullYear(); //获取年份
  var month = date1.getMonth() + 1; //获取月份
  var date = date1.getDate(); //获取日期
  var hour = date1.getHours(); //获取时
  var minu = date1.getMinutes(); //获取分钟
  var sec = date1.getSeconds(); //获取秒钟
  var date6 = year + '-' + month + '-' + date + '/' + hour + ':' + minu + ':' + sec;
  return date6;
};

module.exports = {
  readNycOptions,
  getFormatTime,
};
