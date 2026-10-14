"""Generate local Compose secrets without replacing an existing .env."""
from pathlib import Path
import os
import secrets

root = Path(__file__).resolve().parents[1]
path = root / '.env'
try:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    print('Existing .env preserved.')
else:
    with os.fdopen(fd, 'w') as out:
        out.write(f'POSTGRES_PASSWORD={secrets.token_urlsafe(32)}\n')
        out.write('S3_ACCESS_KEY=filetrail-local\n')
        out.write(f'S3_SECRET_KEY={secrets.token_urlsafe(32)}\n')
        out.write('WEB_PORT=4173\nSECURE_COOKIE=false\n')
    print('Created .env with random local credentials. Run docker compose up --build -d.')
