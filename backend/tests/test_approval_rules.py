import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import approval_rules as rules


class ApprovalRulesTest(unittest.TestCase):
    def test_status_flow(self):
        self.assertEqual(rules.SUBMITTABLE_FROM, ("draft", "rejected"))
        self.assertEqual(rules.REVIEWABLE_FROM, ("pending",))
        self.assertNotIn("approved", rules.SUBMITTABLE_FROM)
        self.assertNotIn("draft", rules.REVIEWABLE_FROM)

    def test_every_status_has_label(self):
        self.assertEqual(set(rules.STATUS_LABELS), set(rules.STATUSES))

    def test_reviewers(self):
        for role in ("Admin", "Manager", " manager ", "ADMIN"):
            self.assertTrue(rules.is_reviewer(role), role)
        for role in ("Editor", "Employee", "Viewer", "", None):
            self.assertFalse(rules.is_reviewer(role), role)

    def test_viewer_cannot_use(self):
        for role in ("Viewer", "", None):
            self.assertFalse(rules.can_access(role), role)
        for role in ("Admin", "Manager", "Editor", "Employee"):
            self.assertTrue(rules.can_access(role), role)

    def test_who_can_submit(self):
        self.assertTrue(rules.can_submit("Editor", 3, 3))
        self.assertFalse(rules.can_submit("Editor", 4, 3))
        self.assertFalse(rules.can_submit("Manager", 2, 3))
        self.assertTrue(rules.can_submit("Admin", 1, 3))
        self.assertFalse(rules.can_submit("Viewer", 5, 5))

    def test_submit_needs_title_and_content(self):
        self.assertEqual(rules.submit_errors("Tiêu đề", "Nội dung"), {})
        self.assertIn("title", rules.submit_errors("   ", "Nội dung"))
        self.assertIn("title", rules.submit_errors(None, "Nội dung"))
        self.assertIn("content", rules.submit_errors("Tiêu đề", "  \n "))
        self.assertIn("content", rules.submit_errors("Tiêu đề", None))
        self.assertIn("title", rules.submit_errors("x" * (rules.TITLE_MAX + 1), "Nội dung"))
        self.assertEqual(rules.submit_errors("x" * rules.TITLE_MAX, "Nội dung"), {})

    def test_reject_reason(self):
        text, error = rules.clean_reason("  Hình   ảnh \n chưa phù hợp  ")
        self.assertIsNone(error)
        self.assertEqual(text, "Hình ảnh chưa phù hợp")
        for bad in ("", "   ", None, "abcd"):
            self.assertIsNotNone(rules.clean_reason(bad)[1], repr(bad))
        self.assertIsNone(rules.clean_reason("a" * rules.REASON_MAX)[1])
        self.assertIsNotNone(rules.clean_reason("a" * (rules.REASON_MAX + 1))[1])

    def test_log_text_fits_column(self):
        longest = f"Từ chối nội dung #{10**9}: " + "a" * rules.REASON_MAX
        self.assertLess(len(longest), 255)

    def test_state_messages(self):
        self.assertIn("đang chờ", rules.state_message("submit", "pending"))
        self.assertIn("Đã duyệt", rules.state_message("submit", "approved"))
        self.assertIn("chưa được gửi duyệt", rules.state_message("approve", "draft"))
        self.assertIn("không thể từ chối lại", rules.state_message("reject", "approved"))


if __name__ == "__main__":
    unittest.main()
