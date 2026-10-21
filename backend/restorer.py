"""One-time local maintenance tool to restore the explicitly requested admin account.

Run from the backend directory after placing this file alongside app.py:
    python restore_default_admin_once.py

It modifies only instance/smartbasket.db; back up your database first.
Do not run this in a publicly accessible production deployment.
"""
from pathlib import Path
import sqlite3
from werkzeug.security import generate_password_hash

EMAIL = 'admin@smartbasket.local'
PASSWORD = 'admin123'
DB_PATH = Path(__file__).resolve().parent / 'instance' / 'smartbasket.db'


def main():
    if not DB_PATH.is_file():
        raise SystemExit(f'Database not found: {DB_PATH}. Start Flask once first.')
    if input(f'Restore {EMAIL} with a known development password? Type RESTORE: ').strip() != 'RESTORE':
        raise SystemExit('Cancelled; no changes made.')

    with sqlite3.connect(DB_PATH) as connection:
        connection.execute('PRAGMA busy_timeout = 5000')
        tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").fetchone()
        if not tables:
            raise SystemExit('Users table missing; no changes made.')
        account = connection.execute('SELECT id, is_admin FROM users WHERE email = ?', (EMAIL,)).fetchone()
        if account:
            if not account[1]:
                raise SystemExit('This email belongs to a regular user; refusing automatic privilege escalation.')
            connection.execute(
                'UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?',
                (generate_password_hash(PASSWORD), account[0]),
            )
            status = 'Existing admin password restored'
        else:
            collision = connection.execute('SELECT id FROM users WHERE username = ?', ('SystemAdmin',)).fetchone()
            if collision:
                raise SystemExit('Username SystemAdmin already belongs to another account; no changes made.')
            connection.execute(
                'INSERT INTO users (username, email, password_hash, is_admin, is_active) VALUES (?, ?, ?, 1, 1)',
                ('SystemAdmin', EMAIL, generate_password_hash(PASSWORD)),
            )
            status = 'Admin account created'
    print(f'{status} for {EMAIL}. Change this development password immediately.')


if __name__ == '__main__':
    main()
