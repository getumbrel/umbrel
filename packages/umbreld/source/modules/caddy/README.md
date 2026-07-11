# Caddy HTTPS Proxy for Umbrel

This module provides HTTPS support for Umbrel apps using [Caddy](https://caddyserver.com/) as a reverse proxy. It enables secure, encrypted connections to all your self-hosted apps on the local network.

## Features

- **Self-signed SSL/TLS certificates** - Automatically generated on first enable
- **Automatic HTTPS** - All app traffic encrypted without manual certificate management
- **Dynamic app routing** - Apps automatically registered/unregistered as they start/stop
- **HTTP to HTTPS redirect** - Seamless upgrade from HTTP to HTTPS
- **Security headers** - HSTS, X-Frame-Options, and other security headers included
- **Path-based routing** - Apps accessible at `https://umbrel.local/{app-id}/*`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Local Network Clients                     │
│              (https://umbrel.local or IP)                    │
└────────────────────────────────┬────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Caddy Reverse Proxy   │
                    │  (Single Instance)      │
                    │  - Self-signed SSL      │
                    │  - Auto TLS termination │
                    │  - Dynamic routing      │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
    ┌─────────▼────────┐ ┌──────▼───────┐ ┌───────▼──────┐
    │  App 1 Proxy     │ │  App 2 Proxy │ │  App N Proxy │
    │  (app-proxy:4000)│ │(app-proxy:4001)│ │(app-proxy:400N)│
    └─────────┬────────┘ └──────┬───────┘ └───────┬──────┘
              │                 │                 │
    ┌─────────▼────────┐ ┌──────▼───────┐ ┌───────▼──────┐
    │   App Container  │ │ App Container│ │ App Container│
    └──────────────────┘ └──────────────┘ └──────────────┘
```

## Installation

The Caddy module is included in umbreld and starts automatically. To enable HTTPS:

### Via API (Future UI Integration)

```typescript
// Enable Caddy
await umbreld.caddy.setEnabled(true)

// Configure domain (optional, defaults to 'umbrel.local')
await umbreld.caddy.updateSettings({
  enabled: true,
  domain: 'myserver.local'
})

// Get certificate fingerprint for verification
const fingerprint = await umbreld.caddy.getCertificateFingerprint()
console.log('Certificate SHA256:', fingerprint)
```

### Configuration Options

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `false` | Enable/disable HTTPS proxy |
| `domain` | `umbrel.local` | Domain name for the certificate |
| `httpPort` | `80` | HTTP port for redirects |
| `httpsPort` | `443` | HTTPS port for secure access |
| `forceHttps` | `true` | Force redirect HTTP → HTTPS |
| `certificatePath` | Auto | Custom certificate path (optional) |
| `privateKeyPath` | Auto | Custom private key path (optional) |

## Usage

Once enabled, all apps are accessible via HTTPS:

```
https://umbrel.local/mempool/
https://umbrel.local/nextcloud/
https://umbrel.local/bitcoind/
```

### Certificate Trust

Since self-signed certificates are used, browsers will show a warning on first access. You have two options:

1. **Accept the warning** - Click "Advanced" → "Proceed" in your browser
2. **Trust the certificate** - Export the certificate and add it to your system's trusted roots

To view the certificate fingerprint for verification:

```bash
# View fingerprint in umbreld logs
# Or via API
curl -X GET http://localhost:80/api/caddy/certificate
```

## How It Works

### Certificate Generation

On first enable, the module generates a self-signed certificate using OpenSSL:

```bash
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout umbrel.key -out umbrel.crt \
  -subj "/CN=umbrel.local/O=Umbrel/C=US" \
  -addext "subjectAltName=DNS:umbrel.local,DNS:*.umbrel.local,IP:127.0.0.1"
```

Certificates are stored in `${UMBREL_DATA_DIR}/caddy/certs/` and valid for 10 years.

### Dynamic Routing

When an app starts:
1. App reads its proxy configuration from `docker-compose.yml`
2. App calls `umbreld.caddy.registerApp(appId, proxyHost, proxyPort)`
3. Caddy module updates Caddyfile and reloads configuration via Admin API
4. Route `/{appId}/* → {proxyHost}:{proxyPort}` is now active

When an app stops, the route is automatically removed.

### Caddy Configuration

The Caddyfile is auto-generated and looks like:

```caddy
{
    http_port 80
    https_port 443
    auto_https off
    admin 0.0.0.0:2019
}

:443 {
    tls /certs/umbrel.crt /certs/umbrel.key
    
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
    }

    handle /mempool* {
        reverse_proxy mempool_app_proxy:4000
    }
    
    handle /nextcloud* {
        reverse_proxy nextcloud_app_proxy:4001
    }
}

:80 {
    redir https://{host}{uri} permanent
}
```

## Development

### Testing Locally

```bash
# Enable Caddy in development
cd packages/umbreld
npm run dev

# Or test with docker-compose
cd containers/caddy
docker compose -f test/docker-compose.yml up
```

### Test Fixtures

See `test/` directory for test configurations:
- `test/docker-compose.caddy-test.yml` - Basic Caddy test setup
- `test/fixtures/` - Sample app configurations

### Modifying Caddy Module

Key files:
- `packages/umbreld/source/modules/caddy/index.ts` - Main module
- `packages/umbreld/source/modules/caddy/config-builder.ts` - Config generation
- `packages/umbreld/source/modules/caddy/schema.ts` - Settings schema
- `containers/caddy/Dockerfile` - Container build
- `containers/caddy/Caddyfile.template` - Base template

## Troubleshooting

### Certificate Warnings

**Problem**: Browser shows "Your connection is not private"

**Solution**: This is expected with self-signed certificates. Either:
- Click "Advanced" → "Proceed to site (unsafe)" to continue
- Export and trust the certificate in your OS/browser

### App Not Accessible

**Problem**: `https://umbrel.local/myapp` returns 502 Bad Gateway

**Solution**:
1. Check if app is running: `docker ps | grep myapp`
2. Check Caddy logs: `docker logs umbrel_caddy`
3. Verify route registration in umbreld logs
4. Ensure app_proxy container is healthy

### Port Conflicts

**Problem**: Caddy fails to start, port 80/443 already in use

**Solution**:
1. Check what's using the port: `sudo lsof -i :80`
2. Change Caddy ports in settings:
   ```typescript
   await umbreld.caddy.updateSettings({
     httpPort: 8080,
     httpsPort: 8443
   })
   ```

### Certificate Regeneration

**Problem**: Need to regenerate certificates (e.g., changed domain)

**Solution**:
```bash
# Delete existing certificates
rm -rf ${UMBREL_DATA_DIR}/caddy/certs/*

# Restart Caddy module
docker restart umbrel_caddy

# Or via API
await umbreld.caddy.setEnabled(false)
await umbreld.caddy.setEnabled(true)
```

## Security Considerations

### Self-Signed Certificates

- **Pros**: Easy setup, no external dependencies, provides encryption
- **Cons**: Browser warnings, manual trust required per device

For production deployments or to avoid warnings, consider:
1. Using a real domain with Let's Encrypt (requires public DNS)
2. Setting up a local CA and trusting it on all devices
3. Using mdns/Bonjour with self-signed certs for discovery

### Network Security

- All app traffic is encrypted between client and Caddy
- Internal traffic (Caddy → app_proxy) remains on Docker network
- HSTS headers prevent downgrade attacks
- Security headers protect against common web vulnerabilities

## Future Enhancements

- [ ] UI integration for enabling/disabling HTTPS
- [ ] Certificate export/download functionality
- [ ] Support for Let's Encrypt with DNS challenge
- [ ] Local CA mode for trusted certificates
- [ ] Subdomain routing (`myapp.umbrel.local`)
- [ ] WebSocket connection pooling
- [ ] Rate limiting and DDoS protection
- [ ] Access logging and analytics

## License

Part of the Umbrel project. See main repository for license information.
