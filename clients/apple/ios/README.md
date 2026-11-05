# Umbrel (iOS)

The iPhone companion app for connecting to umbrelOS, opening apps, and backing up
the photo library. Shared networking and authentication live in
[UmbrelKit](../UmbrelKit).

## In-app browser

umbrelOS and its apps open inside the app (`Sources/Browser`) rather than in
Safari. The native screens cover what only a native app can do (finding an Umbrel,
trusting it, signing in, photo backup, at-a-glance status); everything else is
umbrelOS's own web UI, which always matches the umbrelOS version it is served by.

- Pages load over HTTPS from an address that has just proved the Umbrel's pinned
  identity, and the web view trusts that Umbrel's CA and nothing else for it.
- Signing in natively also creates an umbrelOS browser session, which is replayed
  into the web view for whichever address is in use, replacing cookies an older
  session left there. Without one (an older install, an ended session) the browser
  shows umbrelOS's login page once and keeps the session that produces, after
  umbrelOS confirms it belongs to the account signed in to the app.
- A brand-new Umbrel Home or Raspberry Pi is set up in the same browser, edge to
  edge with no title bar, then signed in to with the password just chosen. Setup
  that restarts the Umbrel onto other drives (an Umbrel Pro, a PC with a drive
  umbrelOS could use for RAID, or restoring a backup) happens in a web browser
  instead, decided before setup starts or as soon as Restore is chosen, because the
  Umbrel comes back with a new identity the app can't follow.
- An app zooms out of its icon into a page with a title bar, and keeps that page
  alive after it closes, so reopening it resumes.
- Pages on the Umbrel stay in the app. Another website someone taps through to from
  the Umbrel (an article, a docs link, a link that opens a new window) opens in
  Safari's in-app view instead, with its real address and Safari's protections, as
  Apple recommends for web content that isn't the app's own. Redirects during a load
  stay in the page, as do links on another site's page and sign-in links whose
  `redirect_uri` comes back to the Umbrel, because a sign-in has to finish in the
  page that started it. An app's page that ends up off the Umbrel that way shows
  that site's address in its title bar instead of the app's name.
- umbrelOS is loaded in the background once the Umbrel is reachable and shown in
  place: its page is transparent and its own wallpaper hidden, so the native
  screens dissolve and umbrelOS's interface appears on the same, unmoving wallpaper.
  A video wallpaper is the exception: umbrelOS draws it itself, inside its page.
  Going to a place inside it (a folder, the App Store) is an in-page navigation,
  not a reload.

The server-side shapes this relies on are pinned in umbreld's
`server/trpc/client-contract.ts`.

## Development

The deployment target is iOS 26.5. The generated Xcode project is not committed.

```bash
brew install xcodegen
cd clients/apple/ios
xcodegen generate
open Umbrel.xcodeproj
```

Build from Xcode or the command line:

```bash
xcodebuild -project Umbrel.xcodeproj -scheme Umbrel \
  -destination 'generic/platform=iOS Simulator' build
```

## TestFlight

Increment `CURRENT_PROJECT_VERSION` in `project.yml`, commit it, and run from a
clean worktree:

```bash
./scripts/upload-testflight.sh
```

The script generates the project, archives the app and PhotoKit extension, and
uploads the signed build to App Store Connect.

## Photo backup transport

PhotoKit performs queued uploads outside the app's custom HTTPS transport, so
backup uses HTTP only to the Tailscale address verified during setup. That
destination is pinned for queued jobs; uploads pause instead of being retargeted
when it is unreachable.

## Physical-device release check

Test PhotoKit uploads on an iPhone before sharing a build. Confirm that backup:

- starts only after setup and continues while the app is backgrounded and locked;
- pauses without Tailscale and resumes after it reconnects;
- reports insufficient storage and recovers through Try Again;
- targets only the selected Umbrel; and
- inventories a large library without memory termination while uploads make progress.
