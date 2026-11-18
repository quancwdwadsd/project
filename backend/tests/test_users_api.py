"""API integration checks against an isolated SQLite database, never the configured MySQL."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from models import Role, User
from routers.users import router
from security import create_access_token


class UsersAPITest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        with self.sessions() as db:
            db.add_all([Role(id=10, role_name='Admin'), Role(id=20, role_name='Editor'),
                        Role(id=30, role_name='Manager'), Role(id=40, role_name='Viewer')])
            db.flush()
            db.add_all([
                User(id=1, username='admin', email='admin@example.com', password_hash='test', role_id=10, status=True),
                User(id=2, username='member', email='member@example.com', password_hash='test', role_id=20, status=True),
                User(id=3, username='manager', email='manager@example.com', password_hash='test', role_id=30, status=True),
                User(id=4, username='viewer', email='viewer@example.com', password_hash='test', role_id=40, status=True),
                User(id=5, username='disabled', email='disabled@example.com', password_hash='test', role_id=10, status=False),
            ])
            db.commit()

        def database():
            with self.sessions() as db:
                yield db

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = database
        self.client = TestClient(app)
        # Exercise the existing authentication and role dependencies without overriding them.
        self.client.headers['Authorization'] = f'Bearer {create_access_token(1)}'

    def admin_requests(self):
        return [
            ('GET', '/users/roles', None),
            ('GET', '/users/', None),
            ('GET', '/users/2', None),
            ('POST', '/users/', {'username': 'candidate', 'email': 'candidate@example.com',
                                'password': 'test-password', 'role_id': 10}),
            ('PUT', '/users/2', {'username': 'changed', 'email': 'changed@example.com'}),
            ('PATCH', '/users/2/access', {'role_id': 10, 'status': False}),
            ('PATCH', '/users/2/role', {'role_id': 10}),
            ('PATCH', '/users/2/status', {'status': False}),
            ('DELETE', '/users/2', None),
        ]

    def user_snapshot(self):
        with self.sessions() as db:
            return [(user.id, user.username, user.email, user.password_hash, user.role_id, user.status)
                    for user in db.query(User).order_by(User.id).all()]

    def test_anonymous_cannot_use_any_admin_endpoint(self):
        before = self.user_snapshot()
        self.client.headers.pop('Authorization')
        for method, url, data in self.admin_requests():
            with self.subTest(method=method, url=url):
                response = self.client.request(method, url, json=data)
                # HTTPBearer's missing-credential status depends on the installed version.
                self.assertIn(response.status_code, (401, 403), response.text)
        self.assertEqual(self.user_snapshot(), before)

    def test_non_admin_cannot_use_any_admin_endpoint(self):
        before = self.user_snapshot()
        for user_id in (2, 3, 4):
            self.client.headers['Authorization'] = f'Bearer {create_access_token(user_id)}'
            for method, url, data in self.admin_requests():
                with self.subTest(user_id=user_id, method=method, url=url):
                    response = self.client.request(method, url, json=data)
                    self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.user_snapshot(), before)

    def test_invalid_or_disabled_identity_is_rejected(self):
        for token in ('invalid', create_access_token(5), create_access_token(999)):
            with self.subTest(token_kind='invalid, disabled or missing user'):
                response = self.client.patch('/users/2/role', json={'role_id': 10},
                                             headers={'Authorization': f'Bearer {token}'})
                self.assertEqual(response.status_code, 401, response.text)

    def test_admin_can_change_role_and_status_separately(self):
        before = self.user_snapshot()[1]
        response = self.client.patch('/users/2/role', json={'role_id': 10})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['role_id'], 10)
        response = self.client.patch('/users/2/status', json={'status': False})
        self.assertEqual(response.status_code, 200, response.text)
        after = self.user_snapshot()[1]
        self.assertEqual(after[:4], before[:4])
        self.assertEqual(after[4:], (10, False))

    def test_admin_can_update_identity(self):
        response = self.client.put('/users/2', json={'username': 'renamed', 'email': 'renamed@example.com'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['username'], 'renamed')
        self.assertEqual(response.json()['role_id'], 20)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def test_access_persists_and_identity_is_unchanged(self):
        response = self.client.patch('/users/2/access', json={'role_id': 10, 'status': False})
        self.assertEqual(response.status_code, 200, response.text)
        with self.sessions() as db:
            user = db.get(User, 2)
            self.assertEqual((user.role_id, user.status), (10, False))
            self.assertEqual((user.username, user.email), ('member', 'member@example.com'))
        self.assertFalse(self.client.get('/users/2').json()['status'])

    def test_failed_role_does_not_change_status(self):
        response = self.client.patch('/users/2/access', json={'role_id': 999, 'status': False})
        self.assertEqual(response.status_code, 404)
        with self.sessions() as db:
            user = db.get(User, 2)
            self.assertEqual((user.role_id, user.status), (20, True))

    def test_cannot_edit_identity_through_access_endpoint(self):
        response = self.client.patch('/users/2/access', json={'role_id': 10, 'status': True, 'username': 'other'})
        self.assertEqual(response.status_code, 422)

    def test_last_admin_protected_on_all_access_routes(self):
        before = self.user_snapshot()
        for method, url, data in [
            ('patch', '/users/1/access', {'role_id': 20, 'status': False}),
            ('patch', '/users/1/role', {'role_id': 20}),
            ('patch', '/users/1/status', {'status': False}),
            ('delete', '/users/1', None),
        ]:
            with self.subTest(method=method, url=url):
                response = self.client.request(method, url, json=data)
                self.assertEqual(response.status_code, 409, response.text)
                self.assertEqual(self.user_snapshot(), before)

    def test_roles_create_and_delete(self):
        self.assertEqual(self.client.get('/users/roles').json()[0], {'id': 10, 'name': 'Admin'})
        payload = {'username': 'new_member', 'email': 'new@example.com', 'password': 'test-password', 'role_id': 20, 'status': False}
        response = self.client.post('/users/', json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        user_id = response.json()['id']
        self.assertFalse(response.json()['status'])
        with self.sessions() as db:
            self.assertNotEqual(db.get(User, user_id).password_hash, payload['password'])
        self.assertEqual(self.client.post('/users/', json=payload).status_code, 400)
        self.assertEqual(self.client.delete(f'/users/{user_id}').status_code, 204)
        self.assertEqual(self.client.get(f'/users/{user_id}').status_code, 404)


if __name__ == '__main__':
    unittest.main()
