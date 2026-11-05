# Apple clients

UmbrelKit provides the connection and security model shared by the iOS and macOS
apps.

## Identifiers

The generated Xcode projects are not committed. Their `project.yml` files are the
source of truth for targets, identifiers, signing, and entitlements.

| Component | Identifier |
| --- | --- |
| Apple Team ID | `JABS8D63XG` |
| iOS app (production) | `com.umbrel.app` |
| iOS app (local development) | `com.umbrel.app.dev` |
| Photos background-upload extension (production) | `com.umbrel.app.photo-background-upload` |
| Photos background-upload extension (local development) | `com.umbrel.app.dev.photo-background-upload` |
| Shared photo-backup group (production) | `group.com.umbrel.app.photos` |
| Shared photo-backup group (local development) | `group.com.umbrel.app.dev` |
| macOS app | `com.umbrel.mac` |

The iOS app and PhotoKit extension use the same shared group for coordinated files
and the source-scoped upload grant. Sessions, certificate pins, and source IDs stay
in the app's private Keychain access group.

## Connection security

Pairing saves the Umbrel's local CA for app-scoped HTTPS trust, and the apps reach
the Umbrel over HTTPS pinned to that CA on every route, Tailscale included. The one
exception is the iOS PhotoKit upload extension, which runs outside the app's
transport and uploads over HTTP only to a verified Tailscale address, inside
Tailscale's authenticated WireGuard tunnel. The Umbrel CA is never installed as a
system-wide certificate. The iOS app's in-app browser extends the same per-Umbrel
trust to the pages it shows.

If an Umbrel's identity changes after pairing (umbrelOS's Reset certificate), the
apps never trust the new CA on their own. The iOS app says it no longer recognizes
the Umbrel and offers to reconnect, which removes it and adds it again.
