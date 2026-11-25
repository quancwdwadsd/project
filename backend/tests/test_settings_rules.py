"""Kiểm thử quy tắc cấu hình UC03. Chạy từ thư mục backend:  python -m unittest discover -s tests -v
Không cần database hay thư viện ngoài."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import settings_rules as rules  # noqa: E402


class SettingsRulesTest(unittest.TestCase):
    def config(self, **over):
        return {**rules.DEFAULTS, **over}

    def test_default_timezone_is_vietnam(self):
        self.assertEqual(rules.DEFAULTS["timezone"], "Asia/Ho_Chi_Minh")

    def test_defaults_are_valid(self):
        self.assertEqual(rules.validate(self.config()), {})

    def test_number_bounds(self):
        for key, low, high in (("sessionMinutes", 5, 480), ("maxFailedLogins", 3, 10), ("minPasswordLength", 8, 32), ("logRetentionMonths", 12, 60)):
            self.assertEqual(rules.validate(self.config(**{key: low})), {}, key)
            self.assertEqual(rules.validate(self.config(**{key: high})), {}, key)
            self.assertIn(key, rules.validate(self.config(**{key: low - 1})), key)
            self.assertIn(key, rules.validate(self.config(**{key: high + 1})), key)

    def test_wrong_types_rejected(self):
        self.assertIn("sessionMinutes", rules.validate(self.config(sessionMinutes="30")))
        self.assertIn("sessionMinutes", rules.validate(self.config(sessionMinutes=30.5)))
        self.assertIn("sessionMinutes", rules.validate(self.config(sessionMinutes=True)))  # bool không được tính là số
        self.assertIn("requireApproval", rules.validate(self.config(requireApproval="true")))
        self.assertIn("timezone", rules.validate(self.config(timezone="Mars/Olympus")))
        self.assertIn("duplicateSlot", rules.validate(self.config(duplicateSlot="ignore")))

    def test_auto_features_need_api(self):
        self.assertIn("autoPost", rules.validate(self.config(autoPost=True, apiConnect=False)))
        self.assertIn("autoSync", rules.validate(self.config(autoSync=True, apiConnect=False)))
        self.assertEqual(rules.validate(self.config(autoPost=True, autoSync=True, apiConnect=True)), {})

    def test_diff_and_impacts(self):
        before = self.config()
        after = self.config(timezone="Asia/Singapore", sessionMinutes=45)
        self.assertEqual({c["key"] for c in rules.diff(before, after)}, {"timezone", "sessionMinutes"})
        self.assertEqual(len(rules.impacts(before, after)), 1)               # chỉ đổi múi giờ mới có cảnh báo
        self.assertEqual(rules.impacts(before, self.config(sessionMinutes=45)), [])
        self.assertTrue(rules.impacts(before, self.config(requireApproval=False)))

    def test_serialize_parse_roundtrip(self):
        for key, value in rules.DEFAULTS.items():
            self.assertEqual(rules.parse_value(key, rules.serialize_value(value)), value, key)
        self.assertIsNone(rules.parse_value("sessionMinutes", "abc"))        # dữ liệu hỏng -> None (dùng mặc định)
        self.assertIsNone(rules.parse_value("timezone", "Mars/Olympus"))


if __name__ == "__main__":
    unittest.main()
