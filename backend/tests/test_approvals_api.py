"""Kiểm thử API duyệt nội dung (T0427C8) trên SQLite tạm, không chạm database MySQL thật."""
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-not-for-production")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from models import ActivityLog, Post, Role, User
from routers.approvals import router
from security import create_access_token


def auth(user_id):
    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


class ApprovalsAPITest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        with self.sessions() as db:
            db.add_all([Role(id=10, role_name="Admin"), Role(id=20, role_name="Editor"), Role(id=30, role_name="Manager")])
            db.flush()
            db.add_all([
                User(id=2, username="staff", email="staff@example.com", password_hash="x", role_id=20, status=True),
                User(id=3, username="manager", email="manager@example.com", password_hash="x", role_id=30, status=True),
                User(id=4, username="staff2", email="staff2@example.com", password_hash="x", role_id=20, status=True),
            ])
            db.add_all([
                Post(id=1, title="Bài nháp", status="draft", created_by=2),
                Post(id=2, title="Bài chờ duyệt", status="pending", created_by=2),
                Post(id=3, title="Bài của quản lý", status="pending", created_by=3),
            ])
            db.commit()

        def database():
            with self.sessions() as db:
                yield db

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = database
        self.client = TestClient(app)

    def post_status(self, post_id):
        with self.sessions() as db:
            post = db.get(Post, post_id)
            return post.status, post.reject_reason, post.approved_by

    def test_full_flow_draft_submit_approve(self):
        r = self.client.post("/approvals/1/submit", headers=auth(2))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "pending")
        r = self.client.post("/approvals/1/approve", headers=auth(3))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.post_status(1), ("approved", None, 3))
        with self.sessions() as db:
            self.assertEqual(db.query(ActivityLog).count(), 2)

    def test_reject_requires_reason_and_keeps_status(self):
        for body in ({}, {"reason": ""}, {"reason": "   "}):
            r = self.client.post("/approvals/2/reject", json=body, headers=auth(3))
            self.assertEqual(r.status_code, 422, body)
        self.assertEqual(self.post_status(2)[0], "pending")

    def test_reject_then_resubmit(self):
        r = self.client.post("/approvals/2/reject", json={"reason": "Sai chính tả"}, headers=auth(3))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.post_status(2), ("rejected", "Sai chính tả", None))
        r = self.client.post("/approvals/2/submit", headers=auth(2))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.post_status(2), ("pending", None, None))

    def test_staff_cannot_review(self):
        self.assertEqual(self.client.post("/approvals/2/approve", headers=auth(4)).status_code, 403)
        self.assertEqual(self.client.post("/approvals/2/reject", json={"reason": "x"}, headers=auth(4)).status_code, 403)
        self.assertEqual(self.client.get("/approvals/pending", headers=auth(4)).status_code, 403)
        self.assertEqual(self.post_status(2)[0], "pending")

    def test_creator_cannot_approve_own_content(self):
        r = self.client.post("/approvals/3/approve", headers=auth(3))
        self.assertEqual(r.status_code, 403)
        r = self.client.post("/approvals/3/reject", json={"reason": "x"}, headers=auth(3))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.post_status(3)[0], "pending")

    def test_only_creator_can_submit(self):
        self.assertEqual(self.client.post("/approvals/1/submit", headers=auth(4)).status_code, 403)
        self.assertEqual(self.post_status(1)[0], "draft")

    def test_cannot_skip_states(self):
        # Nháp không duyệt thẳng được; bài đã chờ duyệt không gửi lại được
        self.assertEqual(self.client.post("/approvals/1/approve", headers=auth(3)).status_code, 409)
        self.assertEqual(self.client.post("/approvals/2/submit", headers=auth(2)).status_code, 409)

    def test_not_found_and_unauthenticated(self):
        self.assertEqual(self.client.post("/approvals/999/approve", headers=auth(3)).status_code, 404)
        self.assertIn(self.client.post("/approvals/2/approve").status_code, (401, 403))

    def test_lists_and_me(self):
        pending = self.client.get("/approvals/pending", headers=auth(3)).json()
        self.assertEqual({p["id"] for p in pending}, {2, 3})
        self.assertEqual(pending[0]["status_label"], "Chờ duyệt")
        mine = self.client.get("/approvals/mine", headers=auth(2)).json()
        self.assertEqual({p["id"] for p in mine}, {1, 2})
        self.assertTrue(self.client.get("/approvals/me", headers=auth(3)).json()["can_review"])
        self.assertFalse(self.client.get("/approvals/me", headers=auth(2)).json()["can_review"])


if __name__ == "__main__":
    unittest.main()
