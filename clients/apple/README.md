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

The iOS app and PhotoKit extension use the same shared group for coordinated files,
the source-scoped upload grant, and a copy of the backed-up Umbrel's public CA.
Sessions, the app's own certificate pins, and source IDs stay in the app's private
Keychain access group.

## Connection security

Pairing saves the Umbrel's local CA for app-scoped HTTPS trust, and the apps reach
the Umbrel over HTTPS pinned to that CA on every route, Tailscale included. The one
exception is the uploads iOS's PhotoKit sends for the photo backup extension while
the app is closed. PhotoKit can't check the Umbrel's certificate, so they go over
HTTP to the Umbrel's Tailscale address. An address in Tailscale's range doesn't prove
the packets go through Tailscale, so each time the extension runs, the Umbrel first
proves over pinned HTTPS that it answers at that address. Without that the extension
cancels the queued uploads and believes nothing; with it, it asks over the same
connection which files the Umbrel has. Uploads queued while the Umbrel was proven can
still go out after Tailscale drops, until the extension next runs, which iOS can
leave for hours. The Umbrel CA is never installed as a system-wide certificate. The
iOS app's in-app browser extends the same per-Umbrel trust to the pages it shows.

If an Umbrel's identity changes after pairing (umbrelOS's Reset certificate), the
apps never trust the new CA on their own. The iOS app says it no longer recognizes
the Umbrel and offers to reconnect, which removes it and adds it again.
