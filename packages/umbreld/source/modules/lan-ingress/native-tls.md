# Native app TLS

Apps that already serve HTTP and TLS on the same browser port can opt in to
encrypted passthrough for explicit DNS suffixes in their installed manifest:

```yaml
nativeTlsHostnameSuffixes:
  - plex.direct
```

A suffix matches its apex and any descendant on a DNS-label boundary, including
`192-168-1-100.server-id.plex.direct`. Declarations contain 1–16 ASCII DNS names
with at least two labels; wildcards, URLs, IP literals and trailing dots are
invalid. Invalid metadata disables only the optional passthrough policy.

Only direct app routes whose original Compose services contain no `app_proxy`
key are eligible. Disabling gateway authentication does not make a gateway
eligible. HTTP retains its existing path. TLS with a declared SNI goes to the
app's fixed loopback port without decryption; Umbrel names, unknown names and
absent SNI keep Umbrel TLS termination. Localhost and `.local` names remain
reserved. No destination is resolved or constructed from client input.

The reader supports ClientHello fragmentation across TCP reads and TLS records.
It validates ClientHello framing and SNI before routing and replays original bytes,
including a coalesced tail. Malformed or oversized input closes the connection.
The opt-in path has an absolute five-second preread deadline, a 64 KiB wire-prefix
limit, 128 process-wide pending slots (including silent clients and handoffs),
and a 32 MiB retained-buffer budget. The 64 KiB cap deliberately rejects larger
ClientHellos, even if valid TLS. Upstream connection and initial writes have a
further five-second deadline. Policy and reserved-name changes replace the
affected route and close its connections through normal ingress shutdown.

Activation needs both a supporting OS and an app update delivering the manifest
field. HTTPS-only apps, clients without SNI and undeclared custom domains need
separate support. The app sees a loopback peer: verify native-client
authentication and LAN/remote classification before opting a package in.
