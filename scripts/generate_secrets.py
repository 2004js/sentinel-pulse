import base64
import secrets

print('SENTINEL_SESSION_SECRET=' + secrets.token_urlsafe(48))
print('SENTINEL_HASH_SALT=' + secrets.token_urlsafe(48))
print('SENTINEL_ENCRYPTION_KEY_B64=' + base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())
