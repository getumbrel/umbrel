from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json

class Server():
    def __init__(self, directory='.'):
        self.directory = directory
        self.get_routes = []
        self.post_routes = []

    # Register a GET handler
    def get(self, path, *handlers):
        self.get_routes.append({'path': path, 'handlers': handlers})

    # Register a POST handler
    def post(self, path, *handlers):
        self.post_routes.append({'path': path, 'handlers': handlers})

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

            def send_error(self, code, message=None):
                if code == 404 and self.path != '/':
                    self.send_response(302)
                    self.send_header('Location', '/')
                    self.end_headers()
                else:
                    super().send_error(code, message)

            # JSON helper
            def send_json_response(self, status_code, data=None):
                if status_code >= 400:
                    data = {'error': True}
                self.send_response(status_code)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(bytes(json.dumps(data), 'utf8'))

            # Loop over routes and execute one if there's a match
            def handle_routes(self, routes):
                # Loop over the registered routes
                for route in routes:
                    # Check if we have a match
                    if self.path == route['path']:
                        try:
                            request = {}
                            # Parse post data
                            if self.headers['Content-Length'] and self.headers['Content-Type'] == 'application/json':
                                content_length = int(self.headers['Content-Length'])
                                raw_post_data = self.rfile.read(content_length)
                                request['post_data'] = json.loads(raw_post_data.decode('utf-8'))
                            # Execute handlers
                            for handler in route['handlers']:
                                response = handler(request)
                            self.send_json_response(200, response)
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
