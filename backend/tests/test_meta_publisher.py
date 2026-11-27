"""Meta publishing adapter tests; all Graph API calls are mocked."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import meta_publisher


class MetaPublisherTests(unittest.IsolatedAsyncioTestCase):
    async def test_facebook_page_post_uses_page_feed_and_plain_text(self):
        calls = []

        async def fake_post(path, token, data):
            calls.append((path, token, data))
            return {"id": "page_123"}

        with patch.dict("os.environ", {
            "META_PAGE_ID": "page-id",
            "META_PAGE_ACCESS_TOKEN": "test-token",
            "META_GRAPH_API_VERSION": "v27.0",
        }), patch.object(meta_publisher, "_post", fake_post):
            result = await meta_publisher.publish_facebook("<p>Hello <strong>World</strong></p>")

        self.assertEqual(result, "page_123")
        self.assertEqual(calls, [("page-id/feed", "test-token", {"message": "Hello World"})])

    async def test_instagram_creates_container_then_publishes(self):
        calls = []

        async def fake_post(path, token, data):
            calls.append((path, token, data))
            return {"id": "container-1"} if path.endswith("/media") else {"id": "media-1"}

        with patch.dict("os.environ", {
            "META_IG_USER_ID": "ig-user",
            "META_IG_ACCESS_TOKEN": "ig-test-token",
        }), patch.object(meta_publisher, "_post", fake_post):
            result = await meta_publisher.publish_instagram(
                "<p>Caption</p>", "https://cdn.example.test/post.jpg"
            )

        self.assertEqual(result, "media-1")
        self.assertEqual(calls, [
            ("ig-user/media", "ig-test-token", {
                "image_url": "https://cdn.example.test/post.jpg", "caption": "Caption"
            }),
            ("ig-user/media_publish", "ig-test-token", {"creation_id": "container-1"}),
        ])

    async def test_missing_facebook_configuration_fails_without_request(self):
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(meta_publisher.MetaPublishError, "META_PAGE_ID"):
                await meta_publisher.publish_facebook("Hello")

    async def test_instagram_requires_public_image_url(self):
        with patch.dict("os.environ", {
            "META_IG_USER_ID": "ig-user",
            "META_IG_ACCESS_TOKEN": "ig-test-token",
        }), patch.object(meta_publisher, "_post") as request:
            with self.assertRaisesRegex(meta_publisher.MetaPublishError, "URL công khai"):
                await meta_publisher.publish_instagram("Caption", None)
        request.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
