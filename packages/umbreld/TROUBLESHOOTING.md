# Troubleshooting

## Unknown file extension ".ts"

If you're getting this errror when running `npm run dev` or another script...

```
Can't run my Node.js Typescript project TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"
```

...It's known to be caused by having the wrong version of Node.js installed. Make sure to install the correct version of node.

The issue is discussed here:

- https://github.com/TypeStrong/ts-node/issues/1997
- https://stackoverflow.com/questions/62096269/cant-run-my-node-js-typescript-project-typeerror-err-unknown-file-extension

If you're using `nvm` or `fnm` you can switch to the right version via:

```
fnm use
```

or

```
nvm use
```

If you're running on Ubuntu, installing a specific version via `apt` will not work. You'll need to use `nvm` or `fnm` to install the correct version.

After installing on Ubuntu, you may see an error like this:

```
Error: libnode.so.108: cannot open shared object file: No such file or directory
    at Object.Module._extensions..node (node:internal/modules/cjs/loader:1243:18)
    at Module.load (node:internal/modules/cjs/loader:1037:32)
    at Function.Module._load (node:internal/modules/cjs/loader:878:12)
    at Module.require (node:internal/modules/cjs/loader:1061:19)
    at require (node:internal/modules/cjs/helpers:103:18)
    at bindings (/root/private-umbrel/packages/umbreld/node_modules/bindings/bindings.js:112:48)
    at Object.<anonymous> (/root/private-umbrel/packages/umbreld/node_modules/drivelist/lib/index.ts:55:27)
    at Module._compile (node:internal/modules/cjs/loader:1159:14)
    at Module._extensions..js (node:internal/modules/cjs/loader:1213:10)
    at Object.require.extensions.<computed> [as .js] (/root/private-umbrel/packages/umbreld/node_modules/ts-node/src/index.ts:1608:43) {
  code: 'ERR_DLOPEN_FAILED'
}
```

The solution is to run `sudo apt install libnode108` as per [this post](https://stackoverflow.com/questions/69378783/node-error-while-loading-shared-libraries-libnode-so-72)
