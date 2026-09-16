const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')

const peers = new Map()
const describeRequest = (request) => ({
	encrypted: Boolean(request.socket.encrypted),
	peer: peers.get(request.socket.remotePort),
})
const handleRequest = (request, response) => {
	response.setHeader('content-type', 'application/json')
	response.end(JSON.stringify(describeRequest(request)))
}

const plain = http.createServer(handleRequest)
const secure = https.createServer(
	{cert: fs.readFileSync('/fixture/cert.pem'), key: fs.readFileSync('/fixture/key.pem')},
	handleRequest,
)

// Send one frame without adding a WebSocket dependency, then stay open for
// route-shutdown checks. The socket tests cover bidirectional frame forwarding.
for (const server of [plain, secure]) {
	server.on('upgrade', (request, socket) => {
		const key = request.headers['sec-websocket-key']
		if (!key) return socket.destroy()
		const accept = crypto
			.createHash('sha1')
			.update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
			.digest('base64')
		socket.write(
			'HTTP/1.1 101 Switching Protocols\r\n' +
				'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
				`Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
		)
		const body = Buffer.from(JSON.stringify(describeRequest(request)))
		if (body.length >= 126) return socket.destroy()
		socket.write(Buffer.concat([Buffer.from([0x81, body.length]), body]))
		socket.on('error', () => socket.destroy())
	})
}

// A loopback hop avoids stalled handshakes when Node's TLS server receives a
// socket after its first read. Track the public peer so assertions don't
// report this fixture's internal loopback hop.
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
Promise.all([listen(plain), listen(secure)]).then(() => {
	net
		.createServer((socket) => {
			socket.once('data', (chunk) => {
				socket.pause()
				const server = chunk[0] === 0x16 ? secure : plain
				const upstream = net.createConnection({host: '127.0.0.1', port: server.address().port}, () => {
					peers.set(upstream.localPort, socket.remoteAddress)
					upstream.write(chunk)
					socket.pipe(upstream).pipe(socket)
					socket.resume()
				})
				let localPort
				upstream.once('connect', () => (localPort = upstream.localPort))
				upstream.once('close', () => {
					peers.delete(localPort)
					socket.destroy()
				})
				upstream.on('error', () => socket.destroy())
				socket.once('close', () => upstream.destroy())
			})
			socket.on('error', () => socket.destroy())
		})
		.listen(4002, '0.0.0.0')
})
