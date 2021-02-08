# Building the debian package

To create a debian package, run the following command on a Debian OS:

```
dpkg-buildpackage --no-sign
```

If you're the maintainer, remove the `--no-sign` to generate a dpkg signed build.