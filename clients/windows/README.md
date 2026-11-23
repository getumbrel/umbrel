# Umbrel (Windows)

The Windows notification-area app discovers Umbrels, connects their SMB shares as
network drives, and opens the umbrelOS web interface. It is the Windows counterpart
of the [macOS menu bar app](../apple/macos). Shared networking and authentication
live in [Umbrel.Core](Umbrel.Core), a .NET port of the Swift
[UmbrelKit](../apple/UmbrelKit) package with the same server contract.

| Project | What |
| --- | --- |
| `Umbrel.Core/` | Discovery, pinned local HTTPS, native sessions, saved devices, DPAPI secret store |
| `Umbrel/` | WPF tray app: icon, popup panel, device list and detail pages, drive mapping |
| `Umbrel.Core.Tests/` | xUnit tests for the contract, validators, resolver, and storage |

## Platform choices

- **WPF, not WinUI 3.** Windows App SDK has no notification-area icon
  (microsoft/WindowsAppSDK#713 is still open), the app never shows a conventional
  main window, and WPF projects build on macOS and Linux with
  `EnableWindowsTargeting`, so the code builds and its tests run without a Windows
  machine.
- **Tray icon through `Shell_NotifyIcon`** with `NOTIFYICON_VERSION_4`, so left click,
  keyboard select, and context-menu requests arrive as distinct events with anchor
  coordinates, and the icon is re-added after Explorer restarts (`TaskbarCreated`).
  The WinForms `NotifyIcon` wrapper never sets the icon version, so it cannot deliver
  those events. All P/Invokes use the source-generated `LibraryImport` marshaller with
  blittable structs, the style the .NET runtime team recommends over `DllImport`.
- **Discovery through `Windows.Devices.Enumeration`** with the DNS-SD protocol id;
  the older `DnssdServiceWatcher` is documented as unsupported.
- **Local HTTPS trust** uses `SslClientAuthenticationOptions.CertificateChainPolicy`
  with `X509ChainTrustMode.CustomRootTrust`: the enrolled Umbrel CA is the only root
  for that device's `HttpClient` and is never installed in a Windows store.
- **Secrets** (native sessions, CA pins, photo-backup grants) are sealed with DPAPI in
  the current-user scope under `%LOCALAPPDATA%\Umbrel\secrets`. Saved devices live
  beside them in `config.json` with the same shape as the Apple apps.
- **Shares** are mapped with `WNetUseConnection` and `CONNECT_REDIRECT`, so Windows
  assigns and reports the drive letter. The mapping also passes
  `CONNECT_REQUIRE_INTEGRITY`, so Windows requires SMB signing and only maps a server
  that holds the share password, also on Windows versions and editions that don't
  require signing themselves. Mappings are session-scoped: they outlive the app like
  Finder mounts, are re-adopted on the next launch after the host proves its pinned
  identity, and are dropped at logoff.
- **Run at startup** uses the `windows.startupTask` extension, which the installed app
  turns on once on first run; turning it off later in Settings is respected. Unpackaged
  builds use the per-user `Run` key only when it's turned on from the tray menu, so a
  development build never keeps launching at sign-in after the installed app replaces
  it.

## Development

Requires the .NET 10 SDK. On Windows:

```powershell
dotnet build Umbrel.sln
dotnet run --project Umbrel
```

On macOS or Linux the solution compiles (the WPF and WinRT targeting packs restore
through `EnableWindowsTargeting`) and the platform-neutral xUnit v3 tests run:

```bash
dotnet build Umbrel.sln
dotnet test --project Umbrel.Core.Tests
```

`global.json` opts `dotnet test` into the Microsoft.Testing.Platform runner that xUnit v3
uses on the .NET 10 SDK; the old VSTest mode refuses v3 projects there.

Unpackaged builds have no package identity: run at startup stays off unless it's
turned on from the tray menu, and the update check reports that updates are
unavailable.

## Distribution

Releases are MSIX packages signed with Azure Artifact Signing, using the account and
certificate profile in `scripts/signing-metadata.json`. Packaging runs on Windows and
needs the Windows SDK, the Artifact Signing Client Tools, and an Azure CLI sign-in with
the Certificate Profile Signer role. Keep all signing credentials outside the
repository.

```powershell
.\scripts\package-msix.ps1 -Architecture x64
```

The script signs the package, timestamps it (Artifact Signing certificates last three
days) and verifies the signature. The `Publisher` in `Package.appxmanifest` and
`Umbrel.appinstaller` must equal the certificate profile's subject exactly.

The package carries its own .NET runtime, and the SDK on the packaging machine decides
its patch level. The script refuses a runtime that is behind Microsoft's latest patch, so
update the .NET SDK before packaging.

Before publishing, install that exact package on a PC where development builds cannot
mask a packaging error.

## Automatic updates

The app is installed through `Umbrel.appinstaller`, which points at the published
package. It has no `UpdateSettings`, so Windows never updates the app on its own.
Umbrel checks every 6 hours like the Mac app, starting a minute after launch (Windows
only reopens an updated app that ran for 60 s), and from Check for Updates. It installs
only after the user chooses Install Update.

The app checks by reading the feed itself, from the address fixed in
`Umbrel/Services/UpdateChecker.cs`, not from the address Windows recorded at install,
which Windows doesn't always keep after an update. So the feed must stay at that
address: installed apps look nowhere else.

The feed isn't signed, so the app doesn't hand it to Windows to install from either. It
accepts the feed only if it names Umbrel's own package and publisher, a four-part
version and an HTTPS package address (`Umbrel.Core/UpdateFeed.cs`), and offers the
update when that version is higher than the installed one. It then has Windows update
from that package with `UpdatePackageAsync`, which installs only a higher version of a
package that is already installed. So an installed app uses nothing from the feed but
`MainPackage`'s `Version` and `Uri`: `UpdateSettings`, `Dependencies` or a `MainBundle`
added there would not take effect for updates from the app.

Every release must increment the versions in `Umbrel/Umbrel.csproj`,
`Package.appxmanifest`, `app.manifest` and `Umbrel.appinstaller` together, including the
package file name in the feed. Upload the `.msix` first and publish `Umbrel.appinstaller`
last.

Release notes go in a Markdown file next to the `.msix`, named after its package
version, for example `Umbrel-0.1.0.1.md`, and follow the macOS rules in
[`../apple/macos/README.md`](../apple/macos/README.md). The update window shows them
the same way, under **What's New in 0.1.0**. Links show only their text: App Installer
files have no field for notes, so the app fetches them over HTTPS on their own rather
than from a signed feed like the macOS appcast, and never makes their links clickable.
A release without a notes file shows no section.

## Runtime model

- DNS-SD provides candidates; Umbrel.Core verifies identity before trusting them.
- Native sessions and local HTTPS trust are stored with DPAPI. Login passwords are
  not persisted.
- SMB passwords stay in memory. Mapped drives intentionally outlive the app.
- Warnings and unhandled exceptions go to `%LOCALAPPDATA%\Umbrel\logs\umbrel.log`
  (1 MB, one older file kept; under MSIX, inside the package's LocalCache). Entries
  record error types, codes and stack traces, not messages, which can name hosts and
  share paths.
- DPAPI keeps the stored sessions and CA pins from other Windows users, but any program
  running as the same user can read or replace them. Windows has no counterpart to the
  Keychain access group that limits the Mac app's items to Umbrel.
