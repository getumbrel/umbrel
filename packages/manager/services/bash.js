const childProcess = require('child_process');

// Sets environment variables on container.
// Env should not contain sensitive data, because environment variables are not secure.
function extendProcessEnv(env) {
  Object.keys(env).map(function (objectKey) { // eslint-disable-line array-callback-return
    process.env[objectKey] = env[objectKey];
  });
}

// Executes docker-compose command with common options
const exec = (command, args, opts) => new Promise((resolve, reject) => {
  const options = opts || {};

  const cwd = options.cwd || null;

  if (options.env) {
    extendProcessEnv(options.env);
  }

  const childProc = childProcess.spawn(command, args, { cwd });

  childProc.on('error', err => {
    reject(err);
  });

  const result = {
    err: '',
    out: ''
  };

  childProc.stdout.on('data', chunk => {
    result.out += chunk.toString();
  });

  childProc.stderr.on('data', chunk => {
    result.err += chunk.toString();
  });

  childProc.on('close', code => {
    if (code === 0) {
      resolve(result);
    } else {
      reject(result.err);
    }
  });

  if (options.log) {
    childProc.stdout.pipe(process.stdout);
    childProc.stderr.pipe(process.stderr);
  }
});

module.exports = {
  exec,
};
