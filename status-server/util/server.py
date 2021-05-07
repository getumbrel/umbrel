from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json

class Server():
    def __init__(self, directory='.'):
        self.directory = directory
        self.routes = []

    # Register a POST handler
    def post(self, path, handler):
        self.routes.append({'path': path, 'handler': handler})

    # Create the server
    def listen(self, port):
        directory = self.directory
        routes = self.routes

        # Create request handler class
        class Handler(SimpleHTTPRequestHandler):
            # Patch the constructor with our directory
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=directory, **kwargs)

            # JSON helper
            def send_json_response(self, status_code, data=None):
                response = {
                    'success': status_code < 400,
                    'result': data
                }
                self.send_response(status_code)
                self.send_header('Content-type','application/json')
                self.end_headers()
                self.wfile.write(bytes(json.dumps(response), 'utf8'))

            def do_POST(self):
                # Loop over the registered routes
                for route in routes:
                    # Check if we have a match
                    if self.path == route['path']:
                        try:
                            # Execute handler
                            self.send_json_response(200, route['handler']())
                        except:
                            # If it failed, send internal server error
                            self.send_json_response(500)
                        # Return the function so we don't execute any more handlers
                        return
                # No routes matched, send 404
                self.send_json_response(404)
        # Start HTTP server and attach handler
        print(f'Server listening on port {port}...')
        with ThreadingHTTPServer(('', port), Handler) as server:
            server.serve_forever()
