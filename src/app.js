/**
 * app
 */
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const express = require('express');
const NYC = require('@jimwong/nyc');
const app = express();
require('express-async-errors');
const { getConfig } = require('../config');
const config = getConfig();
const libCoverage = require('istanbul-lib-coverage');
const { readNycOptions, getFormatTime } = require('./utils');
const serveIndex = require('serve-index');
const AsyncLock = require('async-lock');
const lock = new AsyncLock();
const util = require('util');
const { exec } = require('child_process');
const _exec = util.promisify(exec);
const { checkout, initDir, pull, clone } = require('./utils/git');
const { redis, getAllKeysAndValues } = require('./utils/redis');
const { DBstatus } = require('./utils/constants');

app.set('trust proxy', true);
app.set('port', config.port);
app.set('views', path.join(__dirname, '../pages'));
app.set('view engine', 'ejs');

app.use(bodyParser.json({ limit: '10000kb' }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// 允许跨域
app.all('*', function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  // res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header(
    'Access-Control-Allow-Headers',
    'Access-Control-Allow-Headers, Origin, Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers, x-token'
  );
  res.header('Access-Control-Allow-Methods', 'PUT,POST,GET,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('X-Powered-By', ' 3.2.1');
  if (req.method === 'OPTIONS') res.status(200).send();
  else next(); // 让options请求快速返回
});

app.use(cookieParser());
app.use('/store', serveIndex(path.resolve(process.cwd(), config.sourceLocation), { icons: true }));
app.use(
  '/store',
  express.static(path.resolve(process.cwd(), config.sourceLocation), {
    cacheControl: false,
  })
);
app.use(
  '/public',
  express.static(path.resolve(process.cwd(), './public'), {
    cacheControl: false,
  })
);

/**
 * test
 */
app.get('/', function (req, res, next) {
  res.render('index', { title: 'Express' });
});

// 列表查询
app.get('/list', async (req, res) => {
  getAllKeysAndValues()
    .then((keyValuePairs) => {
      const list = {};
      for (let item in keyValuePairs) {
        const keyArr = item.split('/');
        const projectName = keyArr[0];
        const projectBranch = keyArr[1];

        const branchInfo = {
          ...keyValuePairs[item],
          projectName,
          projectBranch,
          operation_date: getFormatTime(keyValuePairs[item].operation_timeStamp),
        };

        if (list[projectName]) {
          list[projectName].push(branchInfo);
        } else {
          list[projectName] = [branchInfo];
        }
      }

      res.render('list', {
        data: list,
      });
    })
    .catch((err) => {
      console.log('获取数据出错：', err);
      res.render('error', {
        data: {
          message: err,
        },
      });
    });
});

// 覆盖率上报
app.post('/remote', (req, res) => {
  const {
    branch,
    project_name,
    commit_hash = '',
    remote = '',
    increment_coverage_dir = '',
    relative_path_prefix = '',
    data,
  } = req.body;

  const projectPath = path.join(process.cwd(), config.sourceLocation, project_name, branch);
  // 更新数据

  if (lock.isBusy(`${project_name}/${branch}`)) {
    console.log(`${project_name}/${branch} 锁定中...请稍后再试`);
    // 锁定中...
    return res.json({
      success: false,
      message: `${project_name}/${branch} 锁定中...请稍后再试`,
      // 可以增加状态码，端上稍后再重试
    });
  } else {
    lock.acquire(
      `${project_name}/${branch}`,
      (done) => {
        console.log(`${project_name}/${branch} 锁定成功！`);

        try {
          redis.get(`${project_name}/${branch}`, async (err, result) => {
            if (err) {
              throw new Error(`redis get error: ${err}`);
            }
            const resultObj = JSON.parse(result);

            if (!!result) {
              // 记录已存在
              console.log(`${project_name}/${branch} 记录已存在`);
              if (resultObj.DBstatus === DBstatus.DISABLED) {
                // 拉取
                console.log(`${projectPath}/code 准备拉取源码！`);
                clone({ project_name, branch, remote, commit_hash, increment_coverage_dir, relative_path_prefix });
              }

              result = JSON.parse(result);
              redis.set(
                `${project_name}/${branch}`,
                JSON.stringify({
                  ...result,
                  operation_timeStamp: Date.now(),
                  commit_hash,
                  increment_coverage_dir,
                  relative_path_prefix,
                  remote,
                })
              );
              // 更新数据
              fs.readFile(path.join(projectPath, 'coverage_data/coverage.json'), 'utf-8', (err, file_data) => {
                if (err) {
                  throw new Error(`${projectPath}/coverage_data/coverage.json 读取文件失败：${err}`);
                }
                // 合并数据
                let map = libCoverage.createCoverageMap(JSON.parse(file_data));
                map.merge(data);

                // 合并完成，写入数据
                fs.writeFile(
                  path.join(projectPath, 'coverage_data/coverage.json'),
                  JSON.stringify(map.toJSON()),
                  (err) => {
                    if (err) {
                      throw new Error(`${projectPath}/coverage_data/coverage.json 更新文件失败：${err}`);
                    }
                    return done(null, {
                      success: true,
                      message: `${projectPath}/coverage_data/coverage.json 更新成功`,
                    });
                  }
                );
              });
            } else {
              // 记录不存在
              console.log(`${project_name}/${branch} 记录不存在`);

              // 初始化磁盘目录和数据
              initDir(
                {
                  branch,
                  project_name,
                  commit_hash,
                  remote,
                  increment_coverage_dir,
                  relative_path_prefix,
                },
                () => {
                  // 更新数据
                  fs.readFile(path.join(projectPath, 'coverage_data/coverage.json'), 'utf-8', (err, file_data) => {
                    if (err) {
                      throw new Error(`${projectPath}/coverage_data/coverage.json 读取文件失败：${err}`);
                    }
                    // 合并数据
                    let map = libCoverage.createCoverageMap(JSON.parse(file_data));
                    map.merge(data);

                    // 合并完成，写入数据
                    fs.writeFile(
                      path.join(projectPath, 'coverage_data/coverage.json'),
                      JSON.stringify(map.toJSON()),
                      (err) => {
                        if (err) {
                          throw new Error(`${projectPath}/coverage_data/coverage.json 更新文件失败：${err}`);
                        }
                        return done(null, {
                          success: true,
                          message: `${projectPath}/coverage_data/coverage.json 更新成功`,
                        });
                      }
                    );
                  });
                }
              );
            }
          });
        } catch (err) {
          console.log(`${project_name}/${branch} => /remote error: ${err}`);

          done(err, {
            success: false,
            message: `redis.get ${project_name}/${branch} 出错了！`,
          });
        }
      },
      function (err, ret) {
        // 释放锁
        console.log(`${project_name}/${branch} 锁释放`);
        console.log('lock ret: ', ret);
        console.log('lock error: ', err);

        return res.json(ret);
      }
    );
  }
});

// 生成报告
app.post('/report', async (req, res) => {
  try {
    const {
      project_name,
      branch,
      remote,
      isIncrement,
      increment_coverage_dir = '',
      relative_path_prefix = '',
    } = req.body;

    redis.get(`${project_name}/${branch}`, async (err, result) => {
      if (err) {
        throw new Error(`redis get error: ${err}`);
      }
      result = JSON.parse(result);

      if (result.commit_hash) {
        pull(
          {
            project_name,
            branch,
            remote,
            commit_hash: result.commit_hash,
            increment_coverage_dir,
            relative_path_prefix,
          },
          () => {
            // 切分支
            checkout(
              {
                project_name,
                branch,
                remote,
                commit_hash: result.commit_hash,
                increment_coverage_dir,
                relative_path_prefix,
              },
              true,
              async () => {
                // nyc 配置
                const serverPath = path.resolve(process.cwd());
                const nycReportOptions = readNycOptions(serverPath);
                // 这个设置很重要 指定了根路径
                nycReportOptions.cwd = serverPath;

                if (isIncrement) {
                  // 增量代码模式
                  // 对比2个commit id，得到增量数据 ==> increment_coverage_data/coverage.json
                  // 生成增量报告 ==> increment_coverage_assets
                  // 完成
                  //
                  const master_info = await _exec(`git rev-parse --short ${config.mainBranchName}`, {
                    cwd: path.resolve(
                      process.cwd(),
                      `${config.sourceLocation}/${project_name}/${config.mainBranchName}/code`
                    ),
                  });
                  const branch_info = await _exec(`git rev-parse --short ${branch}`, {
                    cwd: path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`),
                  });
                  // 基准 commit id
                  const base_commint_id = await _exec(
                    `git merge-base ${master_info.stdout.trim()} ${branch_info.stdout.trim()}`,
                    {
                      cwd: path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`),
                    }
                  );

                  console.log('branch_info.stdout.trim()', branch_info.stdout.trim());
                  console.log('base_commint_id.stdout.trim()', base_commint_id.stdout.trim());
                  // attention!!!
                  // 下面的正则在 windows 平台用不了
                  // 注意注意！！！
                  const incremt_info = await _exec(
                    `git diff -U0 ${base_commint_id.stdout.trim()} ${branch_info.stdout.trim()} -- ${increment_coverage_dir} | grep -Po '^\\+\\+\\+ ./\\K.*|^@@ -[0-9]+(,[0-9]+)? \\+\\K[0-9]+(,[0-9]+)?(?= @@)'`,
                    { cwd: path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`) }
                  );
                  const info = incremt_info.stdout.trim();

                  const infoArr = info.split('\n');
                  const dataObj = {};
                  const reg = /[A-Za-z./]/;
                  let tar = '';
                  infoArr.forEach((item, index) => {
                    if (reg.test(item)) {
                      tar = relative_path_prefix + '/' + item;
                      dataObj[tar] = [];
                    } else {
                      if (item.indexOf(',') >= 0) {
                        dataObj[tar].push(item);
                      } else {
                        // 为了后面统一处理
                        dataObj[tar].push(`${item},1`);
                      }
                    }
                  });

                  const projectPath = path.join(process.cwd(), config.sourceLocation, project_name, branch);

                  // 读取原覆盖率数据
                  fs.readFile(path.join(projectPath, 'coverage_data/coverage.json'), 'utf-8', (err, file_data) => {
                    if (err) {
                      throw new Error(`${projectPath}/coverage_data/coverage.json 读取文件失败：${err}`);
                    }
                    const json = JSON.parse(file_data);
                    const allData = {};
                    const _allData = {};

                    for (let path in dataObj) {
                      const tarData = json[path];
                      if (tarData) {
                        allData[path] = {
                          ...tarData,
                          increment_data_arr: dataObj[path],
                        };
                      } else {
                        allData[path] = { increment_data_arr: dataObj[path] };
                      }
                    }

                    for (let path in allData) {
                      const pathData = allData[path];
                      _allData[path] = {
                        branchMap: {},
                        b: {},
                        fnMap: {},
                        f: {},
                        statementMap: {},
                        s: {},
                        path: path,
                        _coverageSchema: pathData['_coverageSchema'],
                        hash: pathData['hash'],
                        incrementLines: pathData['increment_data_arr'],
                        inputSourceMap: pathData['inputSourceMap'],
                      };
                      pathData.increment_data_arr.forEach((item) => {
                        const lineArr = item.split(',');
                        const startLines = Number(lineArr[0]);
                        const endLines = Number(lineArr[0]) + Number(lineArr[1]) - 1;
                        // branchMap 和 b
                        for (let branchMapKey in pathData.branchMap) {
                          const branchMapItem = pathData.branchMap[branchMapKey];
                          if (
                            (startLines >= branchMapItem.loc.start.line && startLines <= branchMapItem.loc.end.line) ||
                            (endLines >= branchMapItem.loc.start.line && endLines <= branchMapItem.loc.end.line) ||
                            (startLines >= branchMapItem.loc.start.line && endLines <= branchMapItem.loc.end.line) ||
                            (startLines <= branchMapItem.loc.start.line && endLines >= branchMapItem.loc.end.line)
                          ) {
                            _allData[path].branchMap[branchMapKey] = pathData.branchMap[branchMapKey];
                            _allData[path].b[branchMapKey] = pathData.b[branchMapKey];
                          }
                        }
                        // fnMap 和 f
                        for (let fnMapKey in pathData.fnMap) {
                          const fnMapItem = pathData.fnMap[fnMapKey];
                          if (
                            (startLines >= fnMapItem.loc.start.line && startLines <= fnMapItem.loc.end.line) ||
                            (endLines >= fnMapItem.loc.start.line && endLines <= fnMapItem.loc.end.line) ||
                            (startLines >= fnMapItem.loc.start.line && endLines <= fnMapItem.loc.end.line) ||
                            (startLines <= fnMapItem.loc.start.line && endLines >= fnMapItem.loc.end.line)
                          ) {
                            _allData[path].fnMap[fnMapKey] = pathData.fnMap[fnMapKey];
                            _allData[path].f[fnMapKey] = pathData.f[fnMapKey];
                          }
                        }
                        // statementMap 和 s
                        for (let statementMapKey in pathData.statementMap) {
                          const statementMapItem = pathData.statementMap[statementMapKey];
                          if (
                            (startLines >= statementMapItem.start.line && startLines <= statementMapItem.end.line) ||
                            (endLines >= statementMapItem.start.line && endLines <= statementMapItem.end.line) ||
                            (startLines >= statementMapItem.start.line && endLines <= statementMapItem.end.line) ||
                            (startLines <= statementMapItem.start.line && endLines >= statementMapItem.end.line)
                          ) {
                            _allData[path].statementMap[statementMapKey] = pathData.statementMap[statementMapKey];
                            _allData[path].s[statementMapKey] = pathData.s[statementMapKey];
                          }
                        }
                      });
                    }

                    // 写入数据
                    fs.writeFile(
                      path.join(projectPath, 'increment_coverage_data/coverage.json'),
                      JSON.stringify(_allData),
                      async (err) => {
                        if (err) {
                          throw new Error(`${projectPath}/increment_coverage_data/coverage.json 更新文件失败：${err}`);
                        }
                        console.log(`${projectPath}/increment_coverage_data/coverage.json 更新成功`);
                        const nyc = new NYC({
                          ...nycReportOptions,
                          tempDir: path.join(
                            serverPath,
                            config.sourceLocation,
                            project_name,
                            branch,
                            'increment_coverage_data'
                          ),
                          reportDir: path.join(
                            serverPath,
                            config.sourceLocation,
                            project_name,
                            branch,
                            'increment_coverage_assets'
                          ),
                        });
                        await nyc.report();
                        console.log('增量报告生成成功！');
                        res.json({
                          success: true,
                          message: '报告生成成功',
                        });
                      }
                    );
                  });
                } else {
                  const nyc = new NYC({
                    ...nycReportOptions,
                    tempDir: path.join(serverPath, config.sourceLocation, project_name, branch, 'coverage_data'),
                    reportDir: path.join(serverPath, config.sourceLocation, project_name, branch, 'coverage_assets'),
                  });
                  await nyc.report();
                  console.log('普通报告生成成功！');
                  res.json({
                    success: true,
                    message: '报告生成成功',
                  });
                }

                console.log('切回分支...');
                // 从 commit id 切回到 branch
                // 不然会丢失分支信息
                checkout(
                  {
                    project_name,
                    branch,
                    remote,
                    commit_hash: result.commit_hash,
                    increment_coverage_dir,
                    relative_path_prefix,
                  },
                  false
                );
              }
            );
          }
        );
      }
    });
  } catch (err) {
    console.log(`${project_name}/${branch} => /report error: ${err}`);
    return res.json({
      success: false,
      message: '报告生成失败',
    });
  }
});

/**
 * error
 */
app.use((req, res, next) => {
  const errData = {
    retCode: 404,
    stack: 'not found',
    message: '服务器找不到请求的网页！',
  };
  next(errData);
});
app.use((err, req, res, next) => {
  const errData = {
    retCode: err.retCode || 500,
    stack: err.stack || 'server errors',
    message: err.message || '服务器内部错误！',
  };

  if (req.xhr) {
    res.status(err.retCode || 500).send(errData);
  } else {
    res.status(err.retCode || 500).render('error', errData);
  }
});

module.exports = app;
