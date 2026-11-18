"""Repeatable HTTP checks of the real app, isolated from MySQL and real uploads.

Run from the repository root: backend/.venv/Scripts/python.exe -B backend/tests/check_branch_api.py
Results contain no login tokens or configured database credentials.
"""
import json
import os
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
os.environ['JWT_SECRET_KEY'] = 'isolated-api-test-key-never-used-outside-tests'

import bcrypt
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from models import ActivityLog, Role, User


def run():
    results = []
    covered = set()
    # Importing media creates its upload directory relative to cwd.
    # Import and all uploads therefore run inside this disposable directory.
    original_cwd = Path.cwd()
    with tempfile.TemporaryDirectory(prefix='branch-api-') as scratch:
        os.chdir(scratch)
        try:
            from main import app
            from routers import media
            media.UPLOAD_DIR = str(Path(scratch) / 'uploads')
            engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)

            @event.listens_for(engine, 'connect')
            def enforce_foreign_keys(connection, _):
                connection.execute('PRAGMA foreign_keys=ON')

            Base.metadata.create_all(engine)
            sessions = sessionmaker(bind=engine)
            password = 'Api-test-password-123'
            hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
            with sessions() as db:
                db.add_all([Role(id=10, role_name='Admin'), Role(id=20, role_name='Manager'),
                            Role(id=30, role_name='Editor'), Role(id=1, role_name='Viewer')])
                db.flush()
                for uid, name, role, active in [(1, 'admin', 10, True), (2, 'manager', 20, True),
                                               (3, 'editor', 30, True), (4, 'other', 30, True),
                                               (5, 'disabled', 30, False), (6, 'viewer', 1, True)]:
                    db.add(User(id=uid, username=name, email=f'{name}@example.com',
                                password_hash=hashed, role_id=role, status=active))
                db.flush()
                db.add(ActivityLog(id=1, action='Seed log', user_id=1))
                db.commit()

            def database():
                with sessions() as db:
                    yield db

            app.dependency_overrides[get_db] = database
            with TestClient(app, raise_server_exceptions=False) as client:
                def check(name, method, url, expected=200, actor='admin', body=None, files=None, headers=None, predicate=None):
                    options = {'headers': headers if headers is not None else tokens.get(actor, {})}
                    if body is not None:
                        options['json'] = body
                    if files is not None:
                        options['files'] = files
                    response = client.request(method, url, **options)
                    acceptable = [expected] if isinstance(expected, int) else list(expected)
                    passed = response.status_code in acceptable
                    detail = ''
                    if passed and predicate is not None:
                        try:
                            passed = bool(predicate(response.json()))
                        except (ValueError, KeyError, TypeError):
                            passed = False
                        if not passed:
                            detail = 'Response data assertion failed'
                    if not passed and '/auth/login' not in url:
                        detail = detail or response.text[:350]
                    results.append({'name': name, 'method': method, 'url': url, 'expected': acceptable,
                                    'actual': response.status_code, 'passed': passed, 'detail': detail})
                    print(f"{'PASS' if passed else 'FAIL'} {name}: {response.status_code}")
                    return response

                tokens = {}
                check('Home', 'GET', '/', actor=None)
                check('OpenAPI', 'GET', '/openapi.json', actor=None)
                for actor in ['admin', 'manager', 'editor', 'other', 'viewer']:
                    r = check(f'Login {actor}', 'POST', '/auth/login', actor=None,
                              body={'username_or_email': actor, 'password': password})
                    tokens[actor] = {'Authorization': f"Bearer {r.json()['access_token']}"}
                check('Login by email', 'POST', '/auth/login', actor=None,
                      body={'username_or_email': 'editor@example.com', 'password': password})
                for label, identity, pwd, code in [('wrong password', 'admin', 'wrong', 401),
                                                  ('unknown account', 'unknown', password, 401),
                                                  ('disabled account', 'disabled', password, 403),
                                                  ('password over 72 bytes', 'admin', 'a' * 73, (401, 422))]:
                    check(f'Login {label}', 'POST', '/auth/login', code, actor=None,
                          body={'username_or_email': identity, 'password': pwd})
                check('Login missing fields', 'POST', '/auth/login', 422, actor=None, body={})
                from jose import jwt
                import security
                for name, payload in [('expired token', {'sub': '1', 'exp': 1}),
                                      ('missing token subject', {'exp': 4102444800}),
                                      ('disabled account token', {'sub': '5', 'exp': 4102444800}),
                                      ('deleted account token', {'sub': '99999', 'exp': 4102444800})]:
                    token = jwt.encode(payload, security.SECRET_KEY, algorithm=security.ALGORITHM)
                    check(f'Reject {name}', 'GET', '/posts/', 401, headers={'Authorization': f'Bearer {token}'})

                for prefix in ['posts', 'channels', 'schedules', 'tasks', 'media', 'interactions', 'metrics', 'activity-logs']:
                    check(f'{prefix} list', 'GET', f'/{prefix}/')
                    check(f'{prefix} requires login', 'GET', f'/{prefix}/', (401, 403), actor=None)
                    check(f'{prefix} rejects invalid token', 'GET', f'/{prefix}/', 401,
                          headers={'Authorization': 'Bearer invalid'})
                for prefix in ['posts', 'channels', 'schedules', 'tasks', 'media', 'interactions', 'activity-logs']:
                    check(f'{prefix} missing resource', 'GET', f'/{prefix}/999999', 404)

                check('Roles list', 'GET', '/users/roles')
                check('Users list', 'GET', '/users/')
                check('User detail', 'GET', '/users/3')
                check('User missing', 'GET', '/users/999999', 404)
                user_body = {'username': 'testuser', 'email': 'testuser@example.com', 'password': password, 'role_id': 30, 'status': False}
                uid = check('Create user with disabled status', 'POST', '/users/', 201, body=user_body,
                            predicate=lambda d: d['status'] is False and 'password_hash' not in d).json()['id']
                check('Duplicate user', 'POST', '/users/', 400, body=user_body)
                for label, changes, expected in [('unknown role', {'username': 'another', 'email': 'another@example.com', 'role_id': 99999}, 404),
                                                  ('short password', {'password': 'short'}, 422),
                                                  ('long password', {'password': 'a' * 73}, 422),
                                                  ('unicode password over 72 bytes', {'password': '\u00e1' * 37}, 422),
                                                  ('invalid email', {'email': 'bad-email'}, 422),
                                                  ('short username', {'username': 'ab'}, 422)]:
                    check(f'Create user rejects {label}', 'POST', '/users/', expected, body={**user_body, 'username': 'candidate', 'email': 'candidate@example.com', **changes})
                check('Update identity', 'PUT', f'/users/{uid}', body={'username': 'renamed', 'email': 'renamed@example.com'})
                check('Update duplicate identity', 'PUT', f'/users/{uid}', 400, body={'username': 'admin', 'email': 'admin@example.com'})
                check('Update access', 'PATCH', f'/users/{uid}/access', body={'role_id': 20, 'status': True})
                check('Access rejects extra fields', 'PATCH', f'/users/{uid}/access', 422, body={'role_id': 20, 'status': True, 'username': 'intruder'})
                check('Access rejects missing role', 'PATCH', f'/users/{uid}/access', 404, body={'role_id': 99999, 'status': False})
                check('Access failed transaction preserves data', 'GET', f'/users/{uid}', predicate=lambda d: d['role_id'] == 20 and d['status'] is True)
                check('Change role', 'PATCH', f'/users/{uid}/role', body={'role_id': 30})
                check('Change status', 'PATCH', f'/users/{uid}/status', body={'status': False})
                for method, suffix, body in [('PATCH', '/access', {'role_id': 30, 'status': False}), ('PATCH', '/role', {'role_id': 30}),
                                             ('PATCH', '/status', {'status': False}), ('DELETE', '', None)]:
                    check(f'Protect last admin {suffix or "delete"}', method, f'/users/1{suffix}', 409, body=body)
                check('Delete user', 'DELETE', f'/users/{uid}', 204)
                check('Deleted user missing', 'GET', f'/users/{uid}', 404)

                pid = check('Create post', 'POST', '/posts/', body={'title': 'Test post', 'content': 'Body'}, actor='editor').json()['id']
                check('Read post', 'GET', f'/posts/{pid}')
                check('Edit own post', 'PUT', f'/posts/{pid}', actor='editor', body={'title': 'Updated'})
                check('Reject other author edit', 'PUT', f'/posts/{pid}', 403, actor='other', body={'title': 'Hijacked'})
                check('Reject editor approval', 'PATCH', f'/posts/{pid}/status', 403, actor='editor', body={'status': 'approved'})
                check('Reject invalid post status', 'PATCH', f'/posts/{pid}/status', 400, body={'status': 'invalid'})
                check('Reject empty post title', 'POST', '/posts/', 422, body={'title': ''})
                cid = check('Create channel', 'POST', '/channels/', body={'channel_type': 'facebook', 'channel_name': 'Test', 'assigned_to': 3}).json()['id']
                check('Read channel', 'GET', f'/channels/{cid}')
                check('Edit channel', 'PUT', f'/channels/{cid}', body={'channel_name': 'Updated'})
                check('Channel missing assignee', 'POST', '/channels/', 404, body={'channel_type': 'facebook', 'channel_name': 'Test', 'assigned_to': 99999})
                check('Reject editor channel create', 'POST', '/channels/', 403, actor='editor', body={'channel_type': 'facebook', 'channel_name': 'Test'})
                check('Reject manager channel delete', 'DELETE', f'/channels/{cid}', 403, actor='manager')
                schedule = {'post_id': pid, 'channel_id': cid, 'scheduled_time': '2099-01-01T12:00:00+07:00'}
                check('Reject unapproved post schedule', 'POST', '/schedules/', 400, body=schedule)
                check('Approve post', 'PATCH', f'/posts/{pid}/status', body={'status': 'approved'})
                sid = check('Create schedule', 'POST', '/schedules/', body=schedule).json()['id']
                check('Read schedule', 'GET', f'/schedules/{sid}')
                check('Edit pending schedule', 'PUT', f'/schedules/{sid}', body={'scheduled_time': '2099-02-01T12:00:00Z'})
                check('Reject invalid schedule status', 'PATCH', f'/schedules/{sid}/status', 400, body={'publish_status': 'invalid'})
                check('Change schedule status', 'PATCH', f'/schedules/{sid}/status', body={'publish_status': 'published'})
                check('Reject edit published schedule', 'PUT', f'/schedules/{sid}', 400, body={'scheduled_time': '2099-03-01T12:00:00Z'})
                check('Reject delete published schedule', 'DELETE', f'/schedules/{sid}', 400)
                sid2 = check('Create pending schedule for delete', 'POST', '/schedules/', body=schedule).json()['id']
                check('Delete pending schedule', 'DELETE', f'/schedules/{sid2}')
                check('Reject missing post schedule', 'POST', '/schedules/', 404, body={**schedule, 'post_id': 99999})
                check('Reject missing channel schedule', 'POST', '/schedules/', 404, body={**schedule, 'channel_id': 99999})
                check('Disable channel', 'PUT', f'/channels/{cid}', body={'status': False})
                check('Reject disabled channel schedule', 'POST', '/schedules/', 400, body=schedule)
                tid = check('Create task', 'POST', '/tasks/', body={'title': 'Task', 'assigned_to': 3}).json()['id']
                check('Read task', 'GET', f'/tasks/{tid}')
                check('Edit task', 'PUT', f'/tasks/{tid}', body={'title': 'Updated task'})
                check('Assigned editor updates status', 'PATCH', f'/tasks/{tid}/status', actor='editor', body={'status': 'in_progress'})
                check('Other editor forbidden status', 'PATCH', f'/tasks/{tid}/status', 403, actor='other', body={'status': 'completed'})
                check('Reject invalid task status', 'PATCH', f'/tasks/{tid}/status', 400, body={'status': 'invalid'})
                check('Reject task missing assignee', 'POST', '/tasks/', 404, body={'title': 'Task', 'assigned_to': 99999})
                check('Reject editor task create', 'POST', '/tasks/', 403, actor='editor', body={'title': 'Task'})
                check('Admin with role ID 10 updates task status', 'PATCH', f'/tasks/{tid}/status', 200, body={'status': 'completed'})
                check('Manager with role ID 20 updates task status', 'PATCH', f'/tasks/{tid}/status', 200, actor='manager', body={'status': 'completed'})
                check('Viewer with role ID 1 cannot update others task', 'PATCH', f'/tasks/{tid}/status', 403, actor='viewer', body={'status': 'cancelled'})
                mid = check('Upload PNG', 'POST', '/media/upload', actor='editor', files={'file': ('test.png', b'\x89PNG\r\n\x1a\n', 'image/png')}).json()['id']
                check('Read media', 'GET', f'/media/{mid}')
                check('Reject unsupported upload', 'POST', '/media/upload', 400, files={'file': ('test.txt', b'test', 'text/plain')})
                check('Reject upload missing extension', 'POST', '/media/upload', 400, files={'file': ('test', b'test', 'image/png')})
                check('Reject oversized upload', 'POST', '/media/upload', 400, files={'file': ('large.png', b'x' * (20 * 1024 * 1024 + 1), 'image/png')})
                check('Reject upload missing file', 'POST', '/media/upload', 422)
                check('Attach media', 'POST', f'/posts/{pid}/media', actor='editor', body={'media_id': mid})
                check('List post media', 'GET', f'/posts/{pid}/media')
                check('Reject duplicate attachment', 'POST', f'/posts/{pid}/media', 400, actor='editor', body={'media_id': mid})
                check('Reject other author attachment', 'POST', f'/posts/{pid}/media', 403, actor='other', body={'media_id': mid})
                check('Reject missing media attachment', 'POST', f'/posts/{pid}/media', 404, actor='editor', body={'media_id': 99999})
                iid = check('Create interaction', 'POST', '/interactions/', body={'channel_id': cid, 'content': 'Hello'}).json()['id']
                check('Read interaction', 'GET', f'/interactions/{iid}')
                check('Reject missing interaction channel', 'POST', '/interactions/', 404, body={'channel_id': 99999})
                check('Reject editor interaction create', 'POST', '/interactions/', 403, actor='editor', body={'channel_id': cid})
                check('Delete interaction', 'DELETE', f'/interactions/{iid}')
                check('Create metric', 'POST', '/metrics/', body={'post_id': pid, 'likes': 2})
                check('Read post metrics', 'GET', f'/metrics/post/{pid}', predicate=lambda d: len(d) == 1 and d[0]['likes'] == 2)
                check('Reject negative metric', 'POST', '/metrics/', 422, body={'post_id': pid, 'likes': -1})
                check('Reject missing metric post', 'POST', '/metrics/', 404, body={'post_id': 99999})
                check('Reject editor metric create', 'POST', '/metrics/', 403, actor='editor', body={'post_id': pid})
                check('Read activity log', 'GET', '/activity-logs/1')
                check('Reject editor activity logs', 'GET', '/activity-logs/', 403, actor='editor')

                # Boundary/security probes: expectations reflect safe API behavior.
                check('Anonymous cannot list users', 'GET', '/users/', (401, 403), actor=None)
                check('Editor cannot promote self to admin', 'PATCH', '/users/4/role', 403, actor='other', body={'role_id': 10})
                # Restore the fixture directly after the security probe.
                with sessions() as db:
                    db.get(User, 4).role_id = 30
                    db.commit()
                check('Anonymous cannot create admin', 'POST', '/users/', (401, 403), actor=None,
                      body={'username': 'rogue', 'email': 'rogue@example.com', 'password': password, 'role_id': 10})
                check('User update rejects email over DB limit', 'PUT', '/users/4', 422,
                      body={'username': 'other', 'email': 'a' * 64 + '@' + 'b' * 40 + '.com'})
                check('Post update rejects null title', 'PUT', f'/posts/{pid}', 422, actor='editor', body={'title': None})
                check('Channel update rejects null name', 'PUT', f'/channels/{cid}', 422, body={'channel_name': None})
                check('Task update rejects empty title', 'PUT', f'/tasks/{tid}', 422, body={'title': ''})
                check('Delete task', 'DELETE', f'/tasks/{tid}')
                check('Upload rejects spoofed image MIME', 'POST', '/media/upload', (400, 415, 422), files={'file': ('payload.html', b'<script>alert(1)</script>', 'image/png')})
                check('Delete attached media returns controlled conflict', 'DELETE', f'/media/{mid}', (400, 409))
                check('Detach media', 'DELETE', f'/posts/{pid}/media/{mid}', actor='editor')
                check('Delete media', 'DELETE', f'/media/{mid}')
                check('Delete referenced post returns controlled conflict', 'DELETE', f'/posts/{pid}', (400, 409))
                check('Delete referenced channel returns controlled conflict', 'DELETE', f'/channels/{cid}', (400, 409))
                clean_post = check('Create unreferenced post', 'POST', '/posts/', body={'title': 'Disposable'}).json()['id']
                check('Delete unreferenced post', 'DELETE', f'/posts/{clean_post}')
                clean_channel = check('Create unreferenced channel', 'POST', '/channels/', body={'channel_type': 'test', 'channel_name': 'Disposable'}).json()['id']
                check('Delete unreferenced channel', 'DELETE', f'/channels/{clean_channel}')
                preflight = client.options('/users/', headers={'Origin': 'http://127.0.0.1:5500', 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'content-type,authorization'})
                results.append({'name': 'Localhost CORS preflight', 'method': 'OPTIONS', 'url': '/users/', 'expected': [200], 'actual': preflight.status_code,
                                'passed': preflight.status_code == 200 and preflight.headers.get('access-control-allow-origin') == 'http://127.0.0.1:5500', 'detail': ''})

                # OpenAPI also includes routers stored lazily by newer FastAPI versions.
                # Route coverage means >=1 matching request, not code/branch coverage.
                from starlette.routing import compile_path
                endpoints = {(method.upper(), path) for path, operations in app.openapi()['paths'].items()
                             for method in operations if method in {'get', 'post', 'put', 'patch', 'delete', 'options', 'head'}}
                for method, path in endpoints:
                    pattern, _, _ = compile_path(path)
                    if any(item['method'] == method and pattern.fullmatch(item['url']) for item in results):
                        covered.add((method, path))
                counts = Counter('passed' if item['passed'] else 'failed' for item in results)
                report = {'date': '2026-11-18', 'database': 'SQLite in memory; foreign_keys=ON',
                          'auth': 'Real login and JWT; only get_db overridden',
                          'summary': dict(counts), 'checks': len(results), 'covered_endpoints': len(covered),
                          'total_endpoints': len(endpoints), 'untested_endpoints': sorted(endpoints - covered), 'results': results}
        finally:
            os.chdir(original_cwd)
            if 'app' in locals():
                app.dependency_overrides.pop(get_db, None)
            if 'engine' in locals():
                engine.dispose()
    destination = ROOT / 'docs' / 'api-test-results.json'
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'results'}, ensure_ascii=True, indent=2))
    return 1 if counts['failed'] else 0


if __name__ == '__main__':
    sys.exit(run())
