import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection

from server import build_server


class AppServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.NamedTemporaryFile(delete=False)
        cls.tmp.close()
        cls.server = build_server("127.0.0.1", 18080, cls.tmp.name)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def _request(self, method, path, body=None, headers=None):
        conn = HTTPConnection("127.0.0.1", 18080, timeout=5)
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp.status, data

    def test_upload_requires_auth(self):
        status, _ = self._request("POST", "/v1/documents", body=b"x", headers={"Content-Type": "multipart/form-data; boundary=abc", "Content-Length": "1"})
        self.assertEqual(status, 401)

    def test_full_flow(self):
        upload_headers = {
            "Authorization": "Bearer test",
            "Content-Type": "multipart/form-data; boundary=abc",
            "Content-Length": "4",
            "X-Page-Count": "3",
        }
        status, payload = self._request("POST", "/v1/documents", body=b"test", headers=upload_headers)
        self.assertEqual(status, 201)
        doc = json.loads(payload)
        document_id = doc["document_id"]

        ann_headers = {
            "Authorization": "Bearer test",
            "Content-Type": "application/json",
            "If-Match": "v1",
        }
        ann_body = json.dumps({"annotations": [{"kind": "rect", "x": 1}], "page_ids": [1, 3]}).encode("utf-8")
        ann_headers["Content-Length"] = str(len(ann_body))
        status, payload = self._request("POST", f"/v1/documents/{document_id}/annotations", body=ann_body, headers=ann_headers)
        self.assertEqual(status, 200)
        saved = json.loads(payload)
        self.assertEqual(saved["saved_page_ids"], [1, 3])

        export_headers = {
            "Authorization": "Bearer test",
            "Content-Type": "application/json",
        }
        export_body = json.dumps({"format": "jpg_zip", "annotation_version": "v1"}).encode("utf-8")
        export_headers["Content-Length"] = str(len(export_body))
        status, payload = self._request("POST", f"/v1/documents/{document_id}/exports", body=export_body, headers=export_headers)
        self.assertEqual(status, 202)
        exp = json.loads(payload)
        export_id = exp["export_id"]

        status, payload = self._request("GET", f"/v1/exports/{export_id}", headers={"Authorization": "Bearer test"})
        self.assertEqual(status, 200)
        lookup = json.loads(payload)
        self.assertEqual(lookup["status"], "queued")
        self.assertIsNone(lookup["download_url"])

    def test_page_limit_enforced(self):
        upload_headers = {
            "Authorization": "Bearer test",
            "Content-Type": "multipart/form-data; boundary=abc",
            "Content-Length": "1",
            "X-Page-Count": "101",
        }
        status, _ = self._request("POST", "/v1/documents", body=b"x", headers=upload_headers)
        self.assertEqual(status, 413)


if __name__ == "__main__":
    unittest.main()
