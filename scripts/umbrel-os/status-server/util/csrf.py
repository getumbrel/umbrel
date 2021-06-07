import secrets

csrf_token = secrets.token_hex(32)

def get_csrf_token():
    return csrf_token

def verify_csrf_token(token):
    return token == get_csrf_token()
