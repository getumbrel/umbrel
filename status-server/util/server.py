from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json

class Server():
    def __init__(self, directory='.'):
        self.directory = directory
        self.get_routes = []
        self.post_routes = []

    # Register a GET handler
    def get(self, path, handler):
        self.get_routes.append({'path': path, 'handler': handler})

    # Register a POST handler
    def post(self, path, handler):
        self.post_routes.append({'path': path, 'handler': handler})

    # Create the server
    def listen(self, port):
        directory = self.directory
        post_routes = self.post_routes
        get_routes = self.get_routes

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

            # Loop over routes and execute one if there's a match
            def handle_routes(self, routes):
                # Loop over the registered routes
                for route in routes:
                    # Check if we have a match
                    if self.path == route['path']:
                        try:
                            # Execute handler
                            self.send_json_response(200, route['handler']())
                        except Exception as e:
                            # If it failed, send internal server error
                            print(f'Exception: {e}')
                            self.send_json_response(500)
                        # Route matched, return True
                        return True
                # No routes matched, return False
                return False

            # Try to match a route aganst a GET request
            # else fall back to static server
            def do_GET(self):
                if not self.handle_routes(get_routes):
                    super().do_GET()

            # Try to match a route aganst a POST request
            # else return 404
            def do_POST(self):
                if not self.handle_routes(post_routes):
                    self.send_json_response(404)

        # Start HTTP server and attach handler
        print(f'Server listening on port {port}...')
        with ThreadingHTTPServer(('', port), Handler) as server:
            server.serve_forever()
