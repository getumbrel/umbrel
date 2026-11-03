# Client apps

Native companion apps for umbrelOS. They live outside the npm workspace because
they use native toolchains.

| Path | What |
| --- | --- |
| `apple/UmbrelKit/` | Shared Swift package for discovery, authentication, and API access |
| `apple/macos/` | macOS menu bar app |
| `apple/ios/` | iOS app |
| `windows/Umbrel.Core/` | .NET port of UmbrelKit for the Windows app |
| `windows/Umbrel/` | Windows notification-area app (WPF) |

[`UmbrelKit`](apple/UmbrelKit) owns discovery, native API transport, authentication,
saved devices, and Keychain storage for both Apple apps. The Windows app carries its
own C# port of it with the same behavior and wire shapes. Native clients update
independently of umbrelOS, so their server contracts must remain compatible. The
server's
[`client-contract.ts`](../packages/umbreld/source/modules/server/trpc/client-contract.ts)
keeps those request and response fields covered by umbreld's typecheck.

Each platform README contains its development and release commands.
