"""Kiểm thử quy tắc duyệt nội dung (T0427C8). Chạy từ thư mục backend:
    python -m unittest discover -s tests -p "test_approval_rules.py" -v
Không cần database hay thư viện ngoài."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import approval_rules as rules  # noqa: E402


class ApprovalRulesTest(unittest.TestCase):
    def test_submit_allowed_for_draft_and_rejected_by_owner(self):
        self.assertIsNone(rules.check_submit("draft", 2, 2))
        self.assertIsNone(rules.check_submit("rejected", 2, 2))

    def test_submit_blocked_for_other_states(self):
        for status in ("pending", "approved", "published", "abc"):
            self.assertIsNotNone(rules.check_submit(status, 2, 2), status)

    def test_submit_only_by_creator(self):
        self.assertIsNotNone(rules.check_submit("draft", 2, 9))

    def test_review_only_pending(self):
        self.assertIsNone(rules.check_review("pending", 2, 3))
        for status in ("draft", "approved", "rejected", "published"):
            self.assertIsNotNone(rules.check_review(status, 2, 3), status)

    def test_no_self_review(self):
        self.assertIn("tự duyệt", rules.check_review("pending", 3, 3))

    def test_reject_reason_required(self):
        for empty in (None, "", "   ", "\n\t"):
            self.assertIsNotNone(rules.check_reject_reason(empty), repr(empty))
        self.assertIsNone(rules.check_reject_reason("Sai chính tả ở tiêu đề"))
        self.assertIsNotNone(rules.check_reject_reason("x" * (rules.MAX_REASON_LENGTH + 1)))
        self.assertEqual(rules.clean_reason("  lý do  "), "lý do")

    def test_reviewer_roles(self):
        for role in ("Admin", "admin", "Manager", " manager ", "Quản lý"):
            self.assertTrue(rules.is_reviewer(role), role)
        for role in ("Editor", "Viewer", "Nhân viên", "Người xem", "", None):
            self.assertFalse(rules.is_reviewer(role), role)

    def test_edit_invalidates_approval(self):
        self.assertEqual(rules.reopen_after_edit("approved"), "draft")
        self.assertEqual(rules.reopen_after_edit("pending"), "draft")
        self.assertEqual(rules.reopen_after_edit("draft"), "draft")
        self.assertEqual(rules.reopen_after_edit("rejected"), "rejected")

    def test_labels_vietnamese(self):
        self.assertEqual(rules.label("pending"), "Chờ duyệt")
        self.assertEqual(rules.label("approved"), "Đã duyệt")
        self.assertEqual(rules.label("rejected"), "Từ chối")


if __name__ == "__main__":
    unittest.main()
