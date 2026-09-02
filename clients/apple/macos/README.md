# Umbrel (macOS)

The macOS menu bar app discovers Umbrels, mounts their SMB shares, and opens the
umbrelOS web interface. Shared networking and authentication live in
[UmbrelKit](../UmbrelKit).

## Development

```bash
brew install xcodegen
cd clients/apple/macos
xcodegen generate
open Umbrel.xcodeproj
```

Create a Development-signed universal app for local testing:

```bash
bash scripts/build-app.sh
open "dist/Umbrel.app"
```

The version and build number live in `project.yml`.

## Distribution

Distribution requires a `Developer ID Application` certificate, a `notarytool`
Keychain profile, and [`uv`](https://docs.astral.sh/uv/). Keep all signing and Apple
credentials outside the repository.

```bash
cd clients/apple/macos
export UMBREL_SIGNING_IDENTITY="Developer ID Application: Umbrel, Inc. (JABS8D63XG)"
bash scripts/build-app.sh
```

```bash
bash scripts/package-dmg.sh
bash scripts/notarize-dmg.sh \
  "umbrel-notary" \
  "dist/Umbrel-<version>-<build>.dmg"
```

Share only the notarized, stapled DMG. Before publishing it, install that exact DMG
on a Mac where local build products cannot mask a packaging error.

## Automatic updates

The app uses [Sparkle 2](https://sparkle-project.org/documentation/). Every release
must increment `CURRENT_PROJECT_VERSION`. After notarizing all artifacts, generate
the signed appcast with Sparkle's official tool:

```bash
bash scripts/generate-appcast.sh /path/to/umbrel-macos-updates
```

The signing key remains in Keychain under `umbrel-macos-updates`. Upload immutable
artifacts first and publish `appcast.xml` last.

## Runtime model

- mDNS provides candidates; UmbrelKit verifies identity before trusting them.
- Native sessions and local HTTPS trust are stored in Keychain. Login passwords are
  not persisted.
- SMB passwords stay in memory. Finder mounts intentionally outlive the app.
