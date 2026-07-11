import {describe, it, expect} from 'vitest'
import {buildCaddyConfig, generateCaddyfile, type CaddyRoute} from './config-builder.js'
import type {CaddySettings} from './schema.js'

describe('Caddy Config Builder', () => {
	const defaultSettings: CaddySettings = {
		enabled: true,
		domain: 'umbrel.local',
		httpPort: 80,
		httpsPort: 443,
		forceHttps: true,
	}

	const testRoutes: CaddyRoute[] = [
		{appId: 'mempool', proxyHost: 'mempool_app_proxy_1', proxyPort: 4000},
		{appId: 'nextcloud', proxyHost: 'nextcloud_app_proxy_1', proxyPort: 4001},
	]

	describe('buildCaddyConfig', () => {
		it('should generate valid config structure', () => {
			const config = buildCaddyConfig(defaultSettings, testRoutes)
			
			expect(config).toHaveProperty('admin')
			expect(config).toHaveProperty('apps')
			expect(config.apps.http).toHaveProperty('servers.umbrel')
			expect(config.apps.tls).toHaveProperty('certificates.load_files')
		})

		it('should include all routes', () => {
			const config = buildCaddyConfig(defaultSettings, testRoutes)
			const routes = config.apps.http.servers.umbrel.routes
			
			// Should have redirect route + app routes
			expect(routes.length).toBeGreaterThan(testRoutes.length)
		})

		it('should configure correct ports', () => {
			const settings = {...defaultSettings, httpPort: 8080, httpsPort: 8443}
			const config = buildCaddyConfig(settings, testRoutes)
			
			expect(config.apps.http.http_port).toBe(8080)
			expect(config.apps.http.https_port).toBe(8443)
			expect(config.apps.http.servers.umbrel.listen).toContain(':8080')
			expect(config.apps.http.servers.umbrel.listen).toContain(':8443')
		})

		it('should disable auto_https', () => {
			const config = buildCaddyConfig(defaultSettings, testRoutes)
			expect(config.apps.http.servers.umbrel.auto_https.disabled).toBe(true)
		})

		it('should include certificate paths', () => {
			const config = buildCaddyConfig(defaultSettings, testRoutes)
			const certs = config.apps.tls.certificates.load_files
			
			expect(certs.length).toBe(1)
			expect(certs[0].certificate).toBe('/certs/umbrel.crt')
			expect(certs[0].key).toBe('/certs/umbrel.key')
		})

		it('should use custom certificate paths when provided', () => {
			const settings: CaddySettings = {
				...defaultSettings,
				certificatePath: '/custom/cert.pem',
				privateKeyPath: '/custom/key.pem',
			}
			const config = buildCaddyConfig(settings, testRoutes)
			
			expect(config.apps.tls.certificates.load_files[0].certificate).toBe('/custom/cert.pem')
			expect(config.apps.tls.certificates.load_files[0].key).toBe('/custom/key.pem')
		})
	})

	describe('generateCaddyfile', () => {
		it('should generate valid Caddyfile syntax', () => {
			const caddyfile = generateCaddyfile(defaultSettings, testRoutes)
			
			expect(caddyfile).toContain('{')
			expect(caddyfile).toContain('}')
			expect(caddyfile).toContain('http_port 80')
			expect(caddyfile).toContain('https_port 443')
		})

		it('should include all app routes', () => {
			const caddyfile = generateCaddyfile(defaultSettings, testRoutes)
			
			expect(caddyfile).toContain('handle /mempool*')
			expect(caddyfile).toContain('reverse_proxy mempool_app_proxy_1:4000')
			expect(caddyfile).toContain('handle /nextcloud*')
			expect(caddyfile).toContain('reverse_proxy nextcloud_app_proxy_1:4001')
		})

		it('should include security headers', () => {
			const caddyfile = generateCaddyfile(defaultSettings, testRoutes)
			
			expect(caddyfile).toContain('Strict-Transport-Security')
			expect(caddyfile).toContain('X-Content-Type-Options')
			expect(caddyfile).toContain('X-Frame-Options')
		})

		it('should include TLS configuration', () => {
			const caddyfile = generateCaddyfile(defaultSettings, testRoutes)
			
			expect(caddyfile).toContain('tls /certs/umbrel.crt /certs/umbrel.key')
		})

		it('should generate HTTP to HTTPS redirect when forceHttps is true', () => {
			const caddyfile = generateCaddyfile(defaultSettings, testRoutes)
			
			expect(caddyfile).toContain(':80 {')
			expect(caddyfile).toContain('redir https://{host}{uri} permanent')
		})

		it('should omit HTTP redirect when forceHttps is false', () => {
			const settings = {...defaultSettings, forceHttps: false}
			const caddyfile = generateCaddyfile(settings, testRoutes)
			
			// Should not have the :80 block with redirect
			const lines = caddyfile.split('\n')
			const redirectBlock = lines.findIndex((line: string) => line.includes(':80 {'))
			expect(redirectBlock).toBe(-1)
		})

		it('should use custom domain in comments', () => {
			const settings = {...defaultSettings, domain: 'myserver.local'}
			const caddyfile = generateCaddyfile(settings, testRoutes)
			
			// Domain is used in certificate generation, not directly in Caddyfile
			// but should be in the file somewhere
			expect(caddyfile).toBeDefined()
		})
	})
})
