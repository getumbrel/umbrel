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

The app uses [Sparkle 2](https://sparkle-project.org/documentation/). Every public
release must increment both the user-facing `MARKETING_VERSION` and the internal
`CURRENT_PROJECT_VERSION`. After notarizing all artifacts, generate the signed
appcast with Sparkle's official tool:

```bash
bash scripts/generate-appcast.sh /path/to/umbrel-macos-updates
```

The signing key remains in Keychain under `umbrel-macos-updates`. Upload immutable
artifacts first and publish `appcast.xml` last.

Release notes go in a Markdown file next to the DMG with the same name, for example
`Umbrel-0.1.3-27.md`. The script embeds them in the appcast, and the update window
shows them under a collapsed **What's New in 0.1.3**, scrolling after about eight
lines: before updating, and from Check for Updates once that version is installed.
Keep them short and for users: three or four lines, each about something people will
notice, in their words and without internals, with anything else under "Other fixes
and improvements". One note per line, each starting with `•` or `-` so it shows as a
bullet. Inline Markdown such as bold and links works; headings show as plain text.
Make each version's notes stand on their own, because someone updating from an older
version sees only the newest version's notes.

## Runtime model

- mDNS provides candidates; UmbrelKit verifies identity before trusting them.
- Native sessions and local HTTPS trust are stored in Keychain. Login passwords are
  not persisted.
- SMB passwords stay in memory. Finder mounts intentionally outlive the app.
