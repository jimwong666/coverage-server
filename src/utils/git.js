const { simpleGit } = require('simple-git');
const { DBstatus } = require('./constants');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('../../config');
const config = getConfig();
const { redis } = require('./redis');
const AsyncLock = require('async-lock');
const lock = new AsyncLock();
const { rimraf, rimrafSync, native, nativeSync } = require('rimraf');

const pull = async (info, successCallback = () => {}, failedCallback = () => {}) => {
  const { project_name, branch, remote, commit_hash, increment_coverage_dir, relative_path_prefix } = info;
  try {
    redis.set(
      `${project_name}/${branch}`,
      JSON.stringify({
        DBstatus: DBstatus.LOADING,
        operation_timeStamp: Date.now(),
        commit_hash,
        increment_coverage_dir,
        relative_path_prefix,
        remote,
      })
    );
    await simpleGit(path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`)).pull();
    console.log(`git pull ${project_name}/${branch} 更新成功`);
    redis.set(
      `${project_name}/${branch}`,
      JSON.stringify({
        DBstatus: DBstatus.ENABLED,
        operation_timeStamp: Date.now(),
        commit_hash,
        increment_coverage_dir,
        relative_path_prefix,
        remote,
      })
    );
    successCallback();
  } catch (err) {
    console.log(`git pull error: ${err}`);
    redis.set(
      `${project_name}/${branch}`,
      JSON.stringify({
        DBstatus: DBstatus.ENABLED,
        operation_timeStamp: Date.now(),
        commit_hash,
        increment_coverage_dir,
        relative_path_prefix,
        remote,
      })
    );
    failedCallback();
  }
};

// const checkout_commit = (project_name, branch, commit_hash, remote) => {
//   // 判断此分支的状态
//   // 本地仓库可用，判断 commit id 是否与库中的相同，不同 => 更新仓库
//   // 本地仓库不可用，拉取 => 初始化库中信息，拉取成功后 => 更新仓库
//   redis.get(`${project_name}/${branch}`, async (err, result) => {
//     if (err) {
//       console.log('redis get error', err);
//     }
//     result = JSON.parse(result);

//     if (result && result.DBstatus === DBstatus.ENABLED) {
//       // 分支缓存可用
//       if (commit_hash !== result.commit_hash) {
//         // 判断缓存中的 commit id 是否一致
//         // 不一致，更新缓存
//         redis.set(
//           `${project_name}/${branch}`,
//           JSON.stringify({
//             ...result,
//             operation_timeStamp: Date.now(),
//             commit_hash,
//           })
//         );
//       }
//     } else if (!result || result.DBstatus === DBstatus.DISABLED) {
//       // 分支缓存 loading 中
//       redis.set(
//         `${project_name}/${branch}`,
//         JSON.stringify({
//           ...result,
//           DBstatus: DBstatus.LOADING,
//           operation_timeStamp: Date.now(),
//           current_commit_hash: commit_hash,
//           branch_origin_commit_hash: '',
//         })
//       );

//       // 拉取仓库源码
//       simpleGit()
//         .clone(
//           remote.replace('git.vemic.com', `${config.gitAccountPassword}@git.vemic.com`),
//           path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`),
//           { '--branch': branch }
//         )
//         .cwd(path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`))
//         .checkout(commit_hash)
//         .then((data) => {
//           // 状态 ==> 可用
//           console.log('拉取完成', data);

//           redis.set(
//             `${project_name}/${branch}`,
//             JSON.stringify({
//               DBstatus: DBstatus.ENABLED,
//               operation_timeStamp: Date.now(),
//               commit_hash,
//             })
//           );
//         })
//         .catch((err) => {
//           console.log('拉取失败', err);
//           // 状态 ==> 不可用
//           redis.set(
//             `${project_name}/${branch}`,
//             JSON.stringify({
//               DBstatus: DBstatus.DISABLED,
//               operation_timeStamp: Date.now(),
//               commit_hash,
//             })
//           );
//         });
//     }
//   });
// };

// 拉取分支代码
// const checkout = async (info, isCheckoutCommit = false, successCallback = () => {}, failedCallback = () => {}) => {
//   const { project_name, branch, remote, commit_hash, increment_coverage_dir, relative_path_prefix } = info;
//   try {
//     redis.set(
//       `${project_name}/${branch}`,
//       JSON.stringify({
//         DBstatus: DBstatus.LOADING,
//         operation_timeStamp: Date.now(),
//         commit_hash,
//         increment_coverage_dir,
//         relative_path_prefix,
//       })
//     );

//     // 需要切换 commit id
//     if (isCheckoutCommit) {
//       console.log('切换分支：', `${config.sourceLocation}/${project_name}/${branch} => ${commit_hash}`);

//       simpleGit(path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`))
//         .checkout(commit_hash)
//         .then((data) => {
//           console.log(`切换分支成功：${config.sourceLocation}/${project_name}/${branch} => ${commit_hash}`);

//           redis.set(
//             `${project_name}/${branch}`,
//             JSON.stringify({
//               DBstatus: DBstatus.ENABLED,
//               operation_timeStamp: Date.now(),
//               commit_hash,
//               increment_coverage_dir,
//               relative_path_prefix,
//             })
//           );
//           successCallback();
//         })
//         .catch((err) => {
//           console.log(`切换分支失败：${config.sourceLocation}/${project_name}/${branch} => ${commit_hash}`, err);
//           throw new Error('simple-git checkout commit id failed!');
//         });
//     } else {
//       // 不需要切换 commit id
//       simpleGit()
//         .clone(
//           remote.replace('git.vemic.com', `${config.gitAccountPassword}@git.vemic.com`),
//           path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`),
//           { '--branch': branch }
//         )
//         .then((data) => {
//           console.log(`拉取分支成功：${config.sourceLocation}/${project_name}/${branch}/code`);

//           redis.set(
//             `${project_name}/${branch}`,
//             JSON.stringify({
//               DBstatus: DBstatus.ENABLED,
//               operation_timeStamp: Date.now(),
//               commit_hash,
//               increment_coverage_dir,
//               relative_path_prefix,
//             })
//           );
//           successCallback();
//         })
//         .catch((err) => {
//           console.log(`${project_name}/${branch} 拉取失败：${err}`);
//           throw new Error('simple-git checkout failed!');
//         });
//     }

//     // 如果拉取的分支不是主分支，那么需要拉取主分支
//     if (branch !== config.mainBranchName) {
//       if (lock.isBusy(`${project_name}/${config.mainBranchName}`)) {
//         console.log(`${project_name}/${config.mainBranchName} 锁定中...请稍后再试`);
//       } else {
//         lock.acquire(
//           `${project_name}/${config.mainBranchName}`,
//           (done) => {
//             try {
//               redis.get(`${project_name}/${config.mainBranchName}`, (err, result) => {
//                 if (err) {
//                   throw new Error(`redis get error: ${err}`);
//                 }

//                 if (!result) {
//                   console.log(`${project_name}/${config.mainBranchName} 记录不存在`);

//                   // 初始化磁盘目录和数据
//                   initDir({ ...info, branch: config.mainBranchName }, () => {
//                     done(null, {
//                       success: true,
//                       message: `初始化 目录和文件 成功！`,
//                     });
//                   });
//                 } else if (JSON.parse(result).DBstatus === DBstatus.DISABLED) {
//                   checkout({ project_name, branch: config.mainBranchName, remote, commit_hash }, false);
//                   done(null, {
//                     success: true,
//                     message: `主分支目录已存在！正在拉取源码...`,
//                   });
//                   checkout({ ...info, branch: config.mainBranchName }, false);
//                 } else {
//                   done(null, {
//                     success: true,
//                     message: `主分支目录文件已存在！`,
//                   });
//                 }
//               });
//             } catch (err) {
//               console.log(`拉取主分支 error: ${err}`);
//               redis.set(
//                 `${project_name}/${config.mainBranchName}`,
//                 JSON.stringify({
//                   DBstatus: DBstatus.DISABLED,
//                   operation_timeStamp: Date.now(),
//                   commit_hash: '',
//                 })
//               );

//               done(err, {
//                 success: false,
//                 message: `redis.get ${project_name}/${config.mainBranchName} 出错了！`,
//               });
//             }
//           },
//           function (err, ret) {
//             // lock released
//             console.log('res: ', ret);
//             console.log('error: ', err);
//           }
//         );
//       }
//     }
//   } catch (err) {
//     console.log(`${project_name}/${branch} => checkout error: ${err}`);
//     redis.set(
//       `${project_name}/${branch}`,
//       JSON.stringify({
//         DBstatus: DBstatus.DISABLED,
//         operation_timeStamp: Date.now(),
//         commit_hash,
//         increment_coverage_dir,
//       })
//     );
//     failedCallback();
//     rimraf(path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`))
//       .then((data) => {
//         console.log(`目录删除成功：${config.sourceLocation}/${project_name}/${branch}/code`, data);
//       })
//       .catch((err) => {
//         console.log(`目录删除失败：${config.sourceLocation}/${project_name}/${branch}/code`, err);
//       });
//   }
// };

const opratrMain = (info) => {
  const { project_name, branch, remote, commit_hash, increment_coverage_dir, relative_path_prefix } = info;
  if (branch !== config.mainBranchName) {
    if (lock.isBusy(`${project_name}/${config.mainBranchName}`)) {
      console.log(`${project_name}/${config.mainBranchName} 锁定中...请稍后再试`);
    } else {
      console.log(`开始操作主分支！`);
      lock.acquire(
        `${project_name}/${config.mainBranchName}`,
        (done) => {
          redis.get(`${project_name}/${config.mainBranchName}`, (err, result) => {
            try {
              if (err) {
                throw new Error(`redis get error: ${err}`);
              }
              const mainBranchResult = JSON.parse(result);

              if (!result) {
                console.log(`${project_name}/${config.mainBranchName} 记录不存在`);

                // 初始化磁盘目录和数据
                initDir({ ...info, branch: config.mainBranchName }, () => {
                  done(null, {
                    success: true,
                    message: `初始化 目录和文件 成功！`,
                  });
                });
              } else if (JSON.parse(result).DBstatus === DBstatus.DISABLED) {
                clone({ ...info, branch: config.mainBranchName, commit_hash: mainBranchResult.commit_hash || '' });
                done(null, {
                  success: true,
                  message: `主分支目录已存在！正在拉取源码...`,
                });
              } else {
                done(null, {
                  success: true,
                  message: `主分支目录文件已存在！`,
                });
              }
            } catch (err) {
              console.log(`拉取主分支 error: ${err}`);
              redis.set(
                `${project_name}/${config.mainBranchName}`,
                JSON.stringify({
                  ...mainBranchResult,
                  DBstatus: DBstatus.ENABLED,
                  operation_timeStamp: Date.now(),
                  commit_hash: '',
                  remote,
                })
              );

              done(err, {
                success: false,
                message: `redis.get ${project_name}/${config.mainBranchName} 出错了！`,
              });
            }
          });
        },
        function (err, ret) {
          // lock released
          console.log('res: ', ret);
          console.log('error: ', err);
        }
      );
    }
  }
};

const clone = async (info) => {
  const { project_name, branch, remote, commit_hash, increment_coverage_dir, relative_path_prefix } = info;
  try {
    redis.set(
      `${project_name}/${branch}`,
      JSON.stringify({
        DBstatus: DBstatus.LOADING,
        operation_timeStamp: Date.now(),
        commit_hash,
        increment_coverage_dir,
        relative_path_prefix,
        remote,
      })
    );

    await simpleGit().clone(
      remote.replace('git.vemic.com', `${config.gitAccountPassword}@git.vemic.com`),
      path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`),
      { '--branch': branch }
    );
    console.log('git clone 成功！');

    // 如果拉取的分支不是主分支，那么需要拉取主分支
    opratrMain(info);

    redis.set(
      `${project_name}/${branch}`,
      JSON.stringify({
        DBstatus: DBstatus.ENABLED,
        operation_timeStamp: Date.now(),
        commit_hash,
        increment_coverage_dir,
        relative_path_prefix,
        remote,
      })
    );
  } catch (err) {
    console.log('git clone 失败！', err);
    redis.set(
      `${project_name}/${branch}`,
      JSON.stringify({
        DBstatus: DBstatus.DISABLED,
        operation_timeStamp: Date.now(),
        commit_hash,
        increment_coverage_dir,
        relative_path_prefix,
        remote,
      })
    );
    rimraf(path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`))
      .then((data) => {
        console.log(`目录删除成功：${config.sourceLocation}/${project_name}/${branch}/code`, data);
      })
      .catch((err) => {
        console.log(`目录删除失败：${config.sourceLocation}/${project_name}/${branch}/code`, err);
      });
  }
};

const checkout = async (info, isCheckoutCommit = false, successCallback = () => {}, failedCallback = () => {}) => {
  const { project_name, branch, remote, commit_hash, increment_coverage_dir, relative_path_prefix } = info;
  try {
    redis.set(
      `${project_name}/${branch}`,
      JSON.stringify({
        DBstatus: DBstatus.LOADING,
        operation_timeStamp: Date.now(),
        commit_hash,
        increment_coverage_dir,
        relative_path_prefix,
        remote,
      })
    );

    // 需要切换 commit id
    if (isCheckoutCommit) {
      await simpleGit(path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`)).checkout(
        commit_hash
      );
      redis.set(
        `${project_name}/${branch}`,
        JSON.stringify({
          DBstatus: DBstatus.ENABLED,
          operation_timeStamp: Date.now(),
          commit_hash,
          increment_coverage_dir,
          relative_path_prefix,
          remote,
        })
      );
      console.log(
        `【git checkout commit id】成功！${config.sourceLocation}/${project_name}/${branch} => ${commit_hash}`
      );
      successCallback();
    } else {
      await simpleGit(path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`)).checkout(
        branch
      );

      redis.set(
        `${project_name}/${branch}`,
        JSON.stringify({
          DBstatus: DBstatus.ENABLED,
          operation_timeStamp: Date.now(),
          commit_hash,
          increment_coverage_dir,
          relative_path_prefix,
          remote,
        })
      );
      console.log(`【git checkout branch】成功！${config.sourceLocation}/${project_name}/${branch}`);
      successCallback();
    }

    // 如果拉取的分支不是主分支，那么需要拉取主分支
    opratrMain(info);
  } catch (err) {
    console.log(`git checkout 失败！${config.sourceLocation}/${project_name}：`, err);
    redis.set(
      `${project_name}/${branch}`,
      JSON.stringify({
        DBstatus: DBstatus.ENABLED,
        operation_timeStamp: Date.now(),
        commit_hash,
        increment_coverage_dir,
        relative_path_prefix,
        remote,
      })
    );
    failedCallback();
    rimraf(path.resolve(process.cwd(), `${config.sourceLocation}/${project_name}/${branch}/code`))
      .then((data) => {
        console.log(`目录删除成功：${config.sourceLocation}/${project_name}/${branch}/code`, data);
      })
      .catch((err) => {
        console.log(`目录删除失败：${config.sourceLocation}/${project_name}/${branch}/code`, err);
      });
  }
};

const initDir = (info, jsonInitCallback) => {
  const { branch, project_name } = info;
  const projectPath = path.join(process.cwd(), config.sourceLocation, project_name, branch);

  fs.mkdir(path.join(projectPath, 'coverage_assets'), { recursive: true }, (err, success) => {
    if (err) {
      throw new Error(`${projectPath}/coverage_assets 目录创建失败：${err}`);
    }
    console.log(`${projectPath}/coverage_assets 目录创建成功`, success);
  });

  // 增量代码相关目录
  fs.mkdir(path.join(projectPath, 'increment_coverage_assets'), { recursive: true }, (err, success) => {
    if (err) {
      throw new Error(`${projectPath}/increment_coverage_assets 增量目录创建失败：${err}`);
    }
    console.log(`${projectPath}/increment_coverage_assets 增量目录创建成功`, success);
  });
  fs.mkdir(path.join(projectPath, 'increment_coverage_data'), { recursive: true }, (err, success) => {
    if (err) {
      throw new Error(`${projectPath}/increment_coverage_data 增量目录创建失败：${err}`);
    }
    console.log(`${projectPath}/increment_coverage_data 增量目录创建成功`, success);

    fs.writeFile(path.join(projectPath, 'increment_coverage_data/coverage.json'), JSON.stringify({}), (err) => {
      if (err) {
        throw new Error(`${projectPath}/increment_coverage_data/coverage.json 增量目录创建失败：${err}`);
      }
      console.log(`${projectPath}/increment_coverage_data/coverage.json 写文件成功`);
    });
  });
  fs.mkdir(path.join(projectPath, 'coverage_data'), { recursive: true }, (err, success) => {
    if (err) {
      throw new Error(`${projectPath}/coverage_data 目录创建失败：${err}`);
    }
    console.log(`${projectPath}/coverage_data 目录创建成功`, success);

    fs.writeFile(path.join(projectPath, 'coverage_data/coverage.json'), JSON.stringify({}), (err) => {
      if (err) {
        throw new Error(`${projectPath}/coverage_data/coverage.json 目录创建失败：${err}`);
      }
      console.log(`${projectPath}/coverage_data/coverage.json 写文件成功`);
      // 更新数据
      jsonInitCallback();
    });
  });
  fs.mkdir(path.join(projectPath, 'code'), { recursive: true }, (err, success) => {
    if (err) {
      throw new Error(`${projectPath}/code 目录创建失败：${err}`);
    }
    console.log(`${projectPath}/code 目录创建成功`, success);

    console.log(`${projectPath}/code 准备拉取源码！`);
    // 拉取代码
    clone(info);
  });
};

module.exports = {
  checkout,
  initDir,
  pull,
  clone,
};
