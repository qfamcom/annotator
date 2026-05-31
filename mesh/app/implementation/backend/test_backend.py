import io
import tempfile
import unittest

from PIL import Image

from app import create_app


def make_pdf_bytes() -> bytes:
    image = Image.new("RGB", (400, 600), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PDF")
    return buffer.getvalue()


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(delete=False)
        self.tmp.close()
        self.app = create_app(db_path=self.tmp.name)
        self.client = self.app.test_client()
        self.auth = {"Authorization": "Bearer test"}
        self.pdf_bytes = make_pdf_bytes()

    def test_upload_requires_auth(self):
        resp = self.client.post("/v1/documents")
        self.assertEqual(resp.status_code, 401)

    def test_full_flow_with_download(self):
        upload = self.client.post(
            "/v1/documents",
            data={"file": (io.BytesIO(self.pdf_bytes), "sample.pdf")},
            headers={**self.auth, "X-Page-Count": "3"},
            content_type="multipart/form-data",
        )
        self.assertEqual(upload.status_code, 201)
        doc = upload.get_json()
        self.assertTrue(isinstance(doc.get("preview_urls"), list) and len(doc["preview_urls"]) >= 1)

        preview = self.client.get(doc["preview_urls"][0])
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.content_type, "image/jpeg")
        preview.close()

        save = self.client.post(
            f"/v1/documents/{doc['document_id']}/annotations",
            json={
                "annotations": [
                    {"kind": "rect", "page": 1, "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2},
                    {"kind": "circle", "page": 1, "x": 0.45, "y": 0.2, "width": 0.2, "height": 0.2},
                    {"kind": "diamond", "page": 1, "x": 0.15, "y": 0.45, "width": 0.2, "height": 0.2},
                    {"kind": "star", "page": 1, "x": 0.5, "y": 0.5, "width": 0.25, "height": 0.25},
                ],
                "page_ids": [1],
            },
            headers={**self.auth, "If-Match": "v1"},
        )
        self.assertEqual(save.status_code, 200)

        create_export = self.client.post(
            f"/v1/documents/{doc['document_id']}/exports",
            json={"format": "jpg_zip", "annotation_version": "v1"},
            headers=self.auth,
        )
        self.assertEqual(create_export.status_code, 202)
        exp = create_export.get_json()

        status = self.client.get(f"/v1/exports/{exp['export_id']}", headers=self.auth)
        self.assertEqual(status.status_code, 200)
        status_json = status.get_json()
        self.assertEqual(status_json["status"], "complete")
        self.assertTrue(status_json["download_url"].endswith("/download"))

        dl = self.client.get(f"/v1/exports/{exp['export_id']}/download")
        self.assertEqual(dl.status_code, 200)
        self.assertIn("application/zip", dl.content_type)
        dl.close()

        create_pdf = self.client.post(
            f"/v1/documents/{doc['document_id']}/exports",
            json={"format": "pdf", "annotation_version": "v1"},
            headers=self.auth,
        )
        self.assertEqual(create_pdf.status_code, 202)
        pdf_exp = create_pdf.get_json()

        pdf_status = self.client.get(f"/v1/exports/{pdf_exp['export_id']}", headers=self.auth)
        self.assertEqual(pdf_status.status_code, 200)
        self.assertEqual(pdf_status.get_json()["status"], "complete")

        pdf_dl = self.client.get(f"/v1/exports/{pdf_exp['export_id']}/download")
        self.assertEqual(pdf_dl.status_code, 200)
        self.assertIn("application/pdf", pdf_dl.content_type)
        pdf_dl.close()

    def test_reject_non_pdf_upload(self):
        upload = self.client.post(
            "/v1/documents",
            data={"file": (io.BytesIO(b"not a pdf"), "sample.txt")},
            headers=self.auth,
            content_type="multipart/form-data",
        )
        self.assertEqual(upload.status_code, 415)


if __name__ == "__main__":
    unittest.main()
