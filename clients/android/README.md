# Umbrel (Android)

The Android app for umbrelOS. It finds and pairs with an Umbrel, signs in, opens umbrelOS
and its apps, and backs up the phone's photos and videos. It's the Android counterpart of
the [iOS app](../apple/ios) and talks to umbreld the same way.

| Module | What |
| --- | --- |
| `umbrelkit/` | Discovery, pinned local HTTPS, native sessions, saved devices, Keystore-sealed secrets and the photo backup engine. A Kotlin port of [`UmbrelKit`](../apple/UmbrelKit) |
| `app/` | The Jetpack Compose app: onboarding, sign-in, Home, Apps, Photos, Profile and the in-app browser |
| `tools/symbols/` | Generates the app's icons |

`minSdk` is 30 because the backup ledger relies on MediaStore's generation counter, added
in Android 11. `targetSdk` is 36: targeting 37 turns on Android's local-network
permission, which the app doesn't request yet.

## Connection security

Pairing pins the Umbrel's local CA. Everything authenticated, photo uploads included,
goes over HTTPS that trusts only that CA, on the local network and through Tailscale
alike. The CA is never installed on the phone. It signs only its own Umbrel's certificate,
so it alone proves identity, and the certificate's names aren't matched against the
address, which often isn't among them (Tailscale in userspace mode, a new DHCP address).
Cleartext is used only for the discovery and identity checks that carry no credentials.

Sessions, CA pins and photo backup grants are sealed with an AES-256-GCM key in the Android
Keystore.

## Photo backup

Android has no system uploader like iOS's, so the app runs backup itself:

- A SQLite ledger tracks the library, built from MediaStore and kept current from its
  generation counter. Files the Umbrel doesn't have yet upload newest first, one at a
  time, with their original bytes and location.
- Turning backup on, Try Again and Reconnect start a user-initiated data transfer job on
  Android 14+, or a long-running worker with a `dataSync` foreground service on Android 11
  to 13. It shows a notification and runs until the queue is empty, waiting out a lost
  Wi-Fi connection.
- After that, a library watcher and an hourly safety net queue WorkManager passes, each
  starting uploads for up to 7 minutes. Android decides when they run: straight away while
  the app is open, but possibly hours later on battery when the app is rarely opened.
- Without "Use mobile data", passes need Wi-Fi or Ethernet that isn't metered, so a phone
  hotspot waits too. They need the Umbrel, not a working internet connection.
- "Select photos" access backs up the selection. With access to everything, setup asks
  once which folders to skip, since Android's library includes every app's media.
- Losing photo access pauses backup rather than turning it off, because Android resets the
  permissions of apps left unused for months.

## In-app browser

umbrelOS and its apps open in a WebView, as on iOS. A page loads only from one of the
Umbrel's addresses, with a certificate that chains to the pinned CA. The web view is signed
in with the app's own login where umbrelOS supports it, and with the password on older
releases. Each account's pages keep their data in their own WebView profile, which is
cleared at sign-out. Other websites open in a Custom Tab.

## Development

Requires the Android SDK with the API 37 platform. Gradle downloads its JDK 21 toolchain
if the machine doesn't have one.

```bash
cd clients/android
./gradlew :umbrelkit:testDebugUnitTest :app:testDebugUnitTest lint
./gradlew :app:assembleDebug
```

Debug builds use the application id `com.umbrel.android.dev`, so they install beside the
Play build. mDNS doesn't reach an emulator, so use "Connect by address" there.

## Release

Increment `versionCode` for every Play upload, and `versionName` for a new version, in
`app/build.gradle.kts`. Set `UMBREL_UPLOAD_KEYSTORE` to the Play upload keystore and
`UMBREL_UPLOAD_KEY_PASSWORD` to its password (the key's alias is `upload`, with the same
password), then run:

```bash
./gradlew :app:bundleRelease
```

Without those variables the bundle is unsigned, which Play rejects. Play App Signing
re-signs it with the app signing key, which Google holds.

The only native code is AndroidX's `libandroidx.graphics.path.so`, which is 16 KB-aligned.
Play warns that it has no debug symbols; AndroidX doesn't publish any.

Backup can't be tested in CI, so try it on a real phone before uploading a build.
