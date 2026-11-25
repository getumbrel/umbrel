"""How umbrelOS's model servers listen: HTTP over the unix socket systemd holds
for the service and starts it for (see the umbrel-embeddings units).

  POST <path>  the bytes to read -> what the model made of them, as JSON
"""

import json
import select
import socket
from http.server import BaseHTTPRequestHandler
from socketserver import UnixStreamServer


class Rejected(Exception):
	"""What was sent is not something the model can read"""


def serve(routes, idle_seconds=None):
	"""Answers each path in `routes` with what its function returns for the
	request's body, and returns once nothing has been asked for `idle_seconds`"""

	class Handler(BaseHTTPRequestHandler):
		def do_POST(self):
			body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
			route = routes.get(self.path)
			if not route:
				return self.respond(404, {'error': 'not found'})
			try:
				self.respond(200, route(body))
			except Rejected as error:
				self.respond(400, {'error': str(error)})
			except Exception as error:
				self.respond(500, {'error': str(error)[:200]})

		def respond(self, status, payload):
			body = json.dumps(payload).encode()
			self.send_response(status)
			self.send_header('Content-Type', 'application/json')
			self.send_header('Content-Length', str(len(body)))
			self.end_headers()
			self.wfile.write(body)

		def log_message(self, *args):
			pass

	with UnixStreamServer(None, Handler, bind_and_activate=False) as server:
		# The listening socket systemd holds for this service
		server.socket.close()
		server.socket = socket.socket(fileno=3)
		# Exiting is safe at any moment: a request that arrives as this does stays
		# on the socket, and systemd starts the server again for it
		while select.select([server], [], [], idle_seconds)[0]:
			server.handle_request()
