#!/usr/bin/env python3
import json
import os
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

MAX_FILE_SIZE_MB = 50
MAX_PAGE_COUNT = 100


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AppState:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = self._connect()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS documents (
                    document_id TEXT PRIMARY KEY,
                    page_count INTEGER NOT NULL,
                    state TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS annotation_versions (
                    document_id TEXT NOT NULL,
                    annotation_version TEXT NOT NULL,
                    saved_page_ids_json TEXT NOT NULL,
                    annotations_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (document_id, annotation_version),
                    FOREIGN KEY (document_id) REFERENCES documents(document_id)
                );

                CREATE TABLE IF NOT EXISTS exports (
                    export_id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    format TEXT NOT NULL,
                    annotation_version TEXT NOT NULL,
                    status TEXT NOT NULL,
                    download_url TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (document_id) REFERENCES documents(document_id)
                );
                """
            )
        finally:
            conn.close()

    def create_document(self, page_count: int) -> dict:
        doc_id = f"doc_{uuid.uuid4().hex[:12]}"
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "INSERT INTO documents (document_id, page_count, state, created_at) VALUES (?, ?, ?, ?)",
                    (doc_id, page_count, "uploaded", utc_now()),
                )
                conn.commit()
            finally:
                conn.close()
        return {"document_id": doc_id, "page_count": page_count, "state": "uploaded"}

    def get_document(self, document_id: str):
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT document_id, page_count, state FROM documents WHERE document_id = ?",
                (document_id,),
            ).fetchone()
        finally:
            conn.close()
        return row

    def save_annotations(self, document_id: str, annotation_version: str, page_ids: list[int], annotations: list) -> dict:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO annotation_versions
                    (document_id, annotation_version, saved_page_ids_json, annotations_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        document_id,
                        annotation_version,
                        json.dumps(page_ids),
                        json.dumps(annotations),
                        utc_now(),
                    ),
                )
                conn.commit()
            finally:
                conn.close()
        return {
            "document_id": document_id,
            "annotation_version": annotation_version,
            "saved_page_ids": page_ids,
        }

    def has_annotation_version(self, document_id: str, annotation_version: str) -> bool:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT 1 FROM annotation_versions WHERE document_id = ? AND annotation_version = ?",
                (document_id, annotation_version),
            ).fetchone()
        finally:
            conn.close()
        return row is not None

    def create_export(self, document_id: str, fmt: str, annotation_version: str) -> dict:
        export_id = f"exp_{uuid.uuid4().hex[:12]}"
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO exports
                    (export_id, document_id, format, annotation_version, status, download_url, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (export_id, document_id, fmt, annotation_version, "queued", None, utc_now()),
                )
                conn.commit()
            finally:
                conn.close()
        return {"export_id": export_id, "status": "queued"}

    def get_export(self, export_id: str):
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT export_id, status, download_url FROM exports WHERE export_id = ?",
                (export_id,),
            ).fetchone()
        finally:
            conn.close()
        return row


class AnnotationHandler(BaseHTTPRequestHandler):
    server_version = "SovereignTriadMesh/0.1"

    def _json(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return None

    def _require_auth(self) -> bool:
        auth = self.headers.get("Authorization", "").strip()
        if not auth:
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return False
        return True

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/v1/documents":
            self._handle_upload_document()
            return

        m = re.fullmatch(r"/v1/documents/([^/]+)/annotations", parsed.path)
        if m:
            self._handle_save_annotations(m.group(1))
            return

        m = re.fullmatch(r"/v1/documents/([^/]+)/exports", parsed.path)
        if m:
            self._handle_create_export(m.group(1))
            return

        self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        m = re.fullmatch(r"/v1/exports/([^/]+)", parsed.path)
        if m:
            self._handle_get_export(m.group(1))
            return

        self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def _handle_upload_document(self) -> None:
        if not self._require_auth():
            return

        content_type = self.headers.get("Content-Type", "")
        if not content_type.startswith("multipart/form-data"):
            self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "unsupported_media_type"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_content_length"})
            return

        if content_length > MAX_FILE_SIZE_MB * 1024 * 1024:
            self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "file_too_large"})
            return

        # Consume payload for correctness; this slice does not parse multipart fields.
        _ = self.rfile.read(content_length)

        page_count_raw = self.headers.get("X-Page-Count", "1")
        try:
            page_count = int(page_count_raw)
        except ValueError:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_page_count"})
            return

        if page_count < 1:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_page_count"})
            return

        if page_count > MAX_PAGE_COUNT:
            self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "page_count_exceeds_limit"})
            return

        document = self.server.app_state.create_document(page_count)
        self._json(HTTPStatus.CREATED, document)

    def _handle_save_annotations(self, document_id: str) -> None:
        if not self._require_auth():
            return

        annotation_version = self.headers.get("If-Match", "").strip()
        if not annotation_version:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "missing_if_match"})
            return

        doc = self.server.app_state.get_document(document_id)
        if doc is None:
            self._json(HTTPStatus.NOT_FOUND, {"error": "document_not_found"})
            return

        body = self._read_json_body()
        if not isinstance(body, dict):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
            return

        annotations = body.get("annotations")
        page_ids = body.get("page_ids")
        if not isinstance(annotations, list) or not isinstance(page_ids, list):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_payload"})
            return

        if any(not isinstance(p, int) for p in page_ids):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_page_ids"})
            return

        max_page = int(doc["page_count"])
        if any(p < 1 or p > max_page for p in page_ids):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "page_out_of_range"})
            return

        result = self.server.app_state.save_annotations(document_id, annotation_version, page_ids, annotations)
        self._json(HTTPStatus.OK, result)

    def _handle_create_export(self, document_id: str) -> None:
        if not self._require_auth():
            return

        doc = self.server.app_state.get_document(document_id)
        if doc is None:
            self._json(HTTPStatus.NOT_FOUND, {"error": "document_not_found"})
            return

        body = self._read_json_body()
        if not isinstance(body, dict):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
            return

        fmt = body.get("format")
        annotation_version = body.get("annotation_version")

        if fmt not in {"pdf", "jpg_zip"}:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_format"})
            return

        if not isinstance(annotation_version, str) or not annotation_version.strip():
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_annotation_version"})
            return

        if not self.server.app_state.has_annotation_version(document_id, annotation_version):
            self._json(HTTPStatus.CONFLICT, {"error": "annotation_version_not_found"})
            return

        result = self.server.app_state.create_export(document_id, fmt, annotation_version)
        self._json(HTTPStatus.ACCEPTED, result)

    def _handle_get_export(self, export_id: str) -> None:
        if not self._require_auth():
            return

        exp = self.server.app_state.get_export(export_id)
        if exp is None:
            self._json(HTTPStatus.NOT_FOUND, {"error": "export_not_found"})
            return

        self._json(
            HTTPStatus.OK,
            {
                "export_id": exp["export_id"],
                "status": exp["status"],
                "download_url": exp["download_url"],
            },
        )

    def log_message(self, fmt: str, *args) -> None:
        # Keep local test output concise.
        return


class AppServer(ThreadingHTTPServer):
    def __init__(self, server_address, RequestHandlerClass, app_state: AppState):
        super().__init__(server_address, RequestHandlerClass)
        self.app_state = app_state


def build_server(host: str, port: int, db_path: str) -> AppServer:
    state = AppState(db_path)
    return AppServer((host, port), AnnotationHandler, state)


def main() -> None:
    host = os.environ.get("APP_HOST", "127.0.0.1")
    port = int(os.environ.get("APP_PORT", "8080"))
    db_path = os.environ.get(
        "APP_DB_PATH",
        "/Users/rikquiao/workspace/annotator_mesh/mesh/app/implementation/data/app_state.db",
    )
    server = build_server(host, port, db_path)
    print(f"app server listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
