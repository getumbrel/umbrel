# umbrelOS releases

Every signed production umbrelOS release, kept as a public record of what was signed. For each release:

- `<version>-manifest.txt` is CI's record of what the release contains: its version and name, umbreld's `version` and `versionName`, the time and Git commit it was built from, Docker image digest, the SHA-256 of every file in it, each update bundle's Rugix bundle hash and the boot flow and architecture of the devices that install it, and which file is its update script if it has one. It never changes.
- `<version>-manifest.txt.ots` is the manifest's OpenTimestamps proof, showing it existed by a Bitcoin block.
- `<version>-release-notes.md` is the release notes users see, in Markdown. Sections after a line like `<!-- umbrelOS from 2.0.x -->`, with a semver range, are for devices updating from those versions, which show that section instead of the general notes before the first one.
- `<version>-manifest.txt.sig` is each signer's signature of the manifest's text, by the key their Mac's Secure Enclave holds, or, in an emergency, the root key's own signature of it, then the root-signed approved signing keys list the signers were approved by. It's everything needed to verify the release with the root key built into umbreld.
- `<version>-release-notes.md.sig` is the same for the release notes, signed after a header with the release's version, so they can't be shown with another release.

Signers sign the text itself rather than hashes of it, so a hardware wallet shows exactly what it signs. On the download server they're `manifest.txt`, `manifest.txt.ots`, `manifest.txt.sig`, `release-notes.md` and `release-notes.md.sig` in the release's directory, like `https://download.umbrel.com/release/2.1.0/`. Test builds, like those tagged `public-<name>`, are at `https://download.umbrel.com/<tag>/`. Renaming them doesn't affect the signatures or the timestamp, which cover contents.

Fixing a release's notes only signs the release notes again, with `./scripts/release-signing sign <release> --release-notes <file>`, never what devices install. A device installs a release whose notes don't verify, without showing them. Signing a release again after a signing key is revoked replaces both signature files. Its manifest and timestamp never change, so its name is fixed with a new build, like what the installed system calls itself.

Check a release with:

```sh
./scripts/release-signing verify https://download.umbrel.com/release/<version>/
ots verify releases/<version>-manifest.txt.ots
```

`umbrelos-signing-keys.txt` is the latest approved signing keys list, which devices fetch from the public repo on GitHub as well as from api.umbrel.com. Its path never changes, since devices in the field have it built in. The list also sets how many approved signers each release needs, and can revoke signed releases with `./scripts/release-signing revoke-release releases/<version>-manifest.txt`, given the manifest's path or URL, like one that breaks devices, which devices then refuse to install whoever signed them. A release is revoked by the SHA-256 of its manifest, a commitment to exactly that release, with its version as a label for people, so a release that reuses a real one's version is revoked separately.

The root key can move to a new hardware wallet with `./scripts/release-signing hand-over-root <public key>`: the current root key signs a handover to the new key, and every list from then on ends with the chain of handovers from the root key built into umbreld, `ROOT_PUBLIC_KEY`, which never changes. Devices verify every handover in the chain, each signed by the key before it, and trust the key at its end. Once a device has seen a handover it only takes lists that continue its chain, so the old key can't sign lists for it, but a device that hasn't seen it trusts the old key until it does, so hand over while the old wallet is still safe and publish the handed-over list straight away. A release made after a handover bundles the list with it, so updating also moves a device to the new key.

`keys/` holds every approved signing keys list the offline root key signed, named by its date like `20261028T120000Z-umbrelos-signing-keys.txt`. `./scripts/release-signing sign-keys-list` writes the latest list and archives each one it signs, and devices accept a list only if it's signed by the root key and newer than the newest one they've seen.

Each signer's key is a P-256 key their Mac's Secure Enclave created, through Apple's CryptoKit, with `./scripts/release-signing provision <name>`, which builds `scripts/secure-enclave-key.swift` with Xcode's command line tools and adds the key's public key to the bundled list. The key never leaves the Secure Enclave: `~/Library/Application Support/umbrelOS Release Signing/wrapped-signing-key` holds it wrapped, encrypted by the Secure Enclave, which only decrypts it inside itself to sign, so no other Mac can use it and deleting the file deletes the key. Every signature needs Touch ID with a finger enrolled when the key was made, and adding or removing a finger makes the key unusable, so its signer revokes it and provisions a new one. Apple doesn't attest Secure Enclave keys, so approving one trusts the signer that it is one.

Signing is the only step the tools do, and they never wait for input, so an agent can run them. `sign <release>` shows exactly what it would sign and a confirmation code, and signs only when run again with `--confirm <code>`, if the release hasn't changed since. Touch ID's dialog names the release and the signing key, so check them there too. `root-sign`, `sign-keys-list` and `hand-over-root` show the message to sign in Sparrow and save it when run again with `--signature`. `sign` and `root-sign` save `manifest.txt.sig` and `release-notes.md.sig` beside a local release, or in the current directory for one on the download server. Upload the files they just wrote to the release's directory, with new release notes if they signed them, then check it with `./scripts/release-signing verify <release>`. `sign` starts from the signatures already published, so uploading its files keeps every other signer's, unless two people sign at the same time.

Only production releases are archived, the ones built from their version's tag at `https://download.umbrel.com/release/<version>/`, since test builds usually share a production release's version. Once one has every signature it needs:

1. Download its `manifest.txt`, `manifest.txt.ots`, `manifest.txt.sig`, `release-notes.md` and `release-notes.md.sig` into `releases/`, named `<version>-manifest.txt` and so on.
2. A few hours later, once its timestamp is in a Bitcoin block, complete it with `ots upgrade releases/<version>-manifest.txt.ots`.
3. Commit them. CI checks every archived release verifies with its release notes, its files are small enough for devices to download and it has an update bundle for every kind of device.

Replace an archived release's notes and signatures when they change, but never its manifest.
