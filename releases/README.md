# umbrelOS releases

A public record of every umbrelOS release since 1.3.0 Beta 3, as published at `https://download.umbrel.com/release/<version>/`.

## Signed releases (2.1.0 Beta 1 onwards)

- `<version>-manifest.txt`: the release's files and their SHA-256 hashes
- `<version>-manifest.txt.ots`: its OpenTimestamps proof
- `<version>-manifest.txt.sig`: its signatures by approved release signing keys
- `<version>-release-notes.md` and `<version>-release-notes.md.sig`: the release notes and their signatures

Verify one with `./scripts/release-signing verify https://download.umbrel.com/release/<version>/`.

## Releases from before signing (1.3.0 Beta 3 to 2.0.1)

- `<version>-SHA256SUMS`: the release's files and their SHA-256 hashes
- `<version>-SHA256SUMS.ots`: its OpenTimestamps proof
- `<version>-SHA256SUMS.asc`: Luke's PGP signature of it, added afterwards, by key `EA9F04E561A1D10987E3E2E693D612A9D61C281A`

Verify one with `gpg --verify <version>-SHA256SUMS.asc <version>-SHA256SUMS`, after fetching the key from keys.openpgp.org.

## Signing keys

`umbrelos-signing-keys.txt` is the current list of approved release signing keys, signed by the root key. `keys/` holds every list the root key has signed. `packages/umbreld/source/modules/update/release-signing.ts` explains how release signing works.

## Adding a release

1. Tag the release. CI builds it and uploads it to `https://download.umbrel.com/release/<version>/`.
2. Open a pull request adding its manifest, timestamp, release notes and signature files here, named `<version>-<file>`.
3. Signers each run `./scripts/release-signing sign https://download.umbrel.com/release/<version>/` and add their `Signature:` lines to the pull request. CI checks every release here, so it fails until there are enough.
4. Merge it. CI then uploads what this directory adds to the download server: more signatures, and release notes that are signed and dated later. It never uploads a manifest or release files. See what it would upload with `./scripts/release-signing sync`.

Once a timestamp is in a Bitcoin block, complete it with `ots upgrade` and merge that too, and CI replaces the pending one on the download server. To fix a release's notes, start them with `<!-- umbrelOS release notes <date> -->`, dated now, so they replace the ones already published.
