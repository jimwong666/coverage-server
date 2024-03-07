const Redis = require('ioredis');
const { getConfig } = require('../../config');
const config = getConfig();
const redis = new Redis({
  host: config.DBhost, // Redis服务器的主机地址
  port: config.DBport, // Redis服务器的端口号
  //password: 'password', //（可选）Redis服务器的密码
  db: config.DBindex, //（可选）选择指定的数据库，默认连接到"0"号数据库
});
redis.on('error', (err) => {
  if (err) {
    console.log(`Redis ${config.DBhost}:${config.port} 连接错误`);
    console.log(err);
    redis.quit(); // 链接失败退出链接
  }
});
redis.on('ready', () => {
  console.log(`Redis ${config.DBhost}:${config.port} 连接成功`);
});

// tools
const getAllKeysAndValues = async (pattern = '*') => {
  let cursor = '0';
  let keys = [];
  let keyValuePairs = {};

  do {
    // 使用SCAN命令获取key
    const reply = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = reply[0];
    keys = reply[1];

    // 如果找到key，使用MGET获取对应的value
    if (keys.length) {
      // const values = await redis.mget(...keys);
      // console.log('keys', keys);
      // keys.forEach((key, index) => {
      //   const keyArr = key.split('/');
      //   keyValuePairs.push({
      //     project: keyArr[0],
      //     branch: keyArr[1],
      //     ...JSON.parse(values[index]),
      //   });
      // });
      const values = await redis.mget(...keys);
      keys.forEach((key, index) => {
        keyValuePairs[key] = JSON.parse(values[index]);
      });
    }
  } while (cursor !== '0');

  return keyValuePairs;
};

module.exports = {
  redis,
  getAllKeysAndValues,
};
