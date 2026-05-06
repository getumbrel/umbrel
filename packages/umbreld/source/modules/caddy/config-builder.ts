import type {CaddySettings} from './schema.js'

export interface CaddyRoute {
	appId: string
	proxyHost: string
	proxyPort: number
	path?: string
}

export interface CaddyConfig {
	admin: {
		listen: string
	}
	apps: {
		http: {
			http_port: number
			https_port: number
			servers: {
				umbrel: {
					listen: string[]
					routes: CaddyRouteConfig[]
					auto_https: {
						disabled: boolean
					}
				}
			}
		}
		tls: {
			certificates: {
				load_files: Array<{
					certificate: string
					key: string
				}>
			}
		}
	}
}

interface CaddyRouteConfig {
	match?: {
		path?: string[]
	}
	handle: Array<{
		handler: string
		reverse_proxy?: {
			upstreams: Array<{
				dial: string
			}>
		}
		redirect?: {
			uri?: string
			status_code?: number
		}
		headers?: {
			response?: {
				set?: Record<string, string>
			}
		}
	}>
	terminal?: boolean
}

export function buildCaddyConfig(settings: CaddySettings, routes: CaddyRoute[]): CaddyConfig {
	const certPath = settings.certificatePath || '/certs/umbrel.crt'
	const keyPath = settings.privateKeyPath || '/certs/umbrel.key'

	const routeConfigs: CaddyRouteConfig[] = []

	// Add routes for each app
	for (const route of routes) {
		const pathPrefix = route.path || `/${route.appId}/*`
		
		routeConfigs.push({
			match: {
				path: [pathPrefix]
			},
			handle: [
				{
					handler: 'reverse_proxy',
					reverse_proxy: {
						upstreams: [
							{
								dial: `${route.proxyHost}:${route.proxyPort}`
							}
						]
					}
				}
			],
			terminal: true
		})
	}

	// Add HTTP to HTTPS redirect if forceHttps is enabled
	if (settings.forceHttps) {
		// Note: Protocol matching is done differently in Caddy
		// We'll handle this in the Caddyfile instead
		// For JSON config, we'd need a separate HTTP server block
	}

	const config: CaddyConfig = {
		admin: {
			listen: '0.0.0.0:2019'
		},
		apps: {
			http: {
				http_port: settings.httpPort,
				https_port: settings.httpsPort,
				servers: {
					umbrel: {
						listen: [
							`:${settings.httpPort}`,
							`:${settings.httpsPort}`
						],
						routes: routeConfigs,
						auto_https: {
							disabled: true
						}
					}
				}
			},
			tls: {
				certificates: {
					load_files: [
						{
							certificate: certPath,
							key: keyPath
						}
					]
				}
			}
		}
	}

	return config
}

export function generateCaddyfile(settings: CaddySettings, routes: CaddyRoute[]): string {
	const domain = settings.domain || 'umbrel.local'
	const certPath = settings.certificatePath || '/certs/umbrel.crt'
	const keyPath = settings.privateKeyPath || '/certs/umbrel.key'
	
	let caddyfile = `# Auto-generated Caddyfile for Umbrel\n`
	caddyfile += `# Do not edit manually - changes will be overwritten\n\n`
	
	// Global options
	caddyfile += `{
    http_port ${settings.httpPort}
    https_port ${settings.httpsPort}
    auto_https off
    admin 0.0.0.0:2019
}\n\n`

	// Main server block
	caddyfile += `:443 {
    tls ${certPath} ${keyPath}
    
    # Security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        X-XSS-Protection "1; mode=block"
    }\n`

	// Add routes for each app
	for (const route of routes) {
		const pathPrefix = route.path || `/${route.appId}`
		caddyfile += `
    handle ${pathPrefix}* {
        reverse_proxy ${route.proxyHost}:${route.proxyPort}
    }\n`
	}

	caddyfile += `}\n\n`

	// HTTP to HTTPS redirect
	if (settings.forceHttps) {
		caddyfile += `:80 {
    redir https://{host}{uri} permanent
}\n`
	}

	return caddyfile
}
