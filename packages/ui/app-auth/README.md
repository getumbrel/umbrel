# Local testing

Make sure umbreld is running

```
cd packages/umbreld
npm run dev
```

Then in another terminal

```
cd packages/ui
pnpm run app-auth:dev
```

Go to `localhost:3001` and make sure you're logged out.

Then, assuming `transmission` is installed and running, open:
http://localhost:2001/app-auth/?origin=host&app=transmission&path=%2Ftransmission%2Fweb%2F

In production, it would be:
http://localhost:2000/?origin=host&app=transmission&path=%2Ftransmission%2Fweb%2F

Login with password and 2fa should work and you should be redirected to the right page.
