#!/usr/bin/env python3
import json
import math
import os
import re
import sqlite3
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pypdfium2 as pdfium
from flask import Flask, jsonify, request, send_file
from PIL import Image, ImageDraw

MAX_FILE_SIZE_MB = 50
MAX_PAGE_COUNT = 100
DOC_ID_PATTERN = re.compile(r"^doc_[a-f0-9]{12}$")
EXPORT_ID_PATTERN = re.compile(r"^exp_[a-f0-9]{12}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AppState:
    def __init__(self, db_path: str, data_root: Path) -> None:
        self.db_path = db_path
        self.data_root = data_root
        self.upload_root = data_root / "uploads"
        self.page_root = data_root / "pages"
        self.export_root = data_root / "exports"
        self._lock = threading.Lock()
        self._init_storage()
        self._init_db()

    def _init_storage(self) -> None:
        self.data_root.mkdir(parents=True, exist_ok=True)
        self.upload_root.mkdir(parents=True, exist_ok=True)
        self.page_root.mkdir(parents=True, exist_ok=True)
        self.export_root.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        conn = self._connect()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS documents (
                    document_id TEXT PRIMARY KEY,
                    page_count INTEGER NOT NULL,
                    state TEXT NOT NULL,
                    source_pdf_path TEXT NOT NULL,
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
                    file_path TEXT,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (document_id) REFERENCES documents(document_id)
                );
                """
            )
            self._migrate_schema(conn)
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def _column_names(conn: sqlite3.Connection, table_name: str) -> set[str]:
        rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        return {str(r[1]) for r in rows}

    def _migrate_schema(self, conn: sqlite3.Connection) -> None:
        doc_cols = self._column_names(conn, "documents")
        if "source_pdf_path" not in doc_cols:
            conn.execute("ALTER TABLE documents ADD COLUMN source_pdf_path TEXT")
            conn.execute("UPDATE documents SET source_pdf_path = '' WHERE source_pdf_path IS NULL")

        export_cols = self._column_names(conn, "exports")
        if "file_path" not in export_cols:
            conn.execute("ALTER TABLE exports ADD COLUMN file_path TEXT")
        if "error_message" not in export_cols:
            conn.execute("ALTER TABLE exports ADD COLUMN error_message TEXT")

    def create_document(self, page_count: int, source_pdf_path: str) -> dict:
        document_id = f"doc_{uuid.uuid4().hex[:12]}"
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "INSERT INTO documents (document_id, page_count, state, source_pdf_path, created_at) VALUES (?, ?, ?, ?, ?)",
                    (document_id, page_count, "uploaded", source_pdf_path, utc_now()),
                )
                conn.commit()
            finally:
                conn.close()

        return {"document_id": document_id, "page_count": page_count, "state": "uploaded"}

    def get_document(self, document_id: str):
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT document_id, page_count, state, source_pdf_path FROM documents WHERE document_id = ?",
                (document_id,),
            ).fetchone()
            return row
        finally:
            conn.close()

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
            return row is not None
        finally:
            conn.close()

    def get_annotations(self, document_id: str, annotation_version: str):
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT annotations_json, saved_page_ids_json FROM annotation_versions WHERE document_id = ? AND annotation_version = ?",
                (document_id, annotation_version),
            ).fetchone()
            if row is None:
                return None
            return {
                "annotations": json.loads(row["annotations_json"]),
                "saved_page_ids": json.loads(row["saved_page_ids_json"]),
            }
        finally:
            conn.close()

    def create_export(self, document_id: str, fmt: str, annotation_version: str) -> dict:
        export_id = f"exp_{uuid.uuid4().hex[:12]}"
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO exports
                    (export_id, document_id, format, annotation_version, status, download_url, file_path, error_message, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (export_id, document_id, fmt, annotation_version, "queued", None, None, None, utc_now()),
                )
                conn.commit()
            finally:
                conn.close()

        return {"export_id": export_id, "status": "queued"}

    def update_export_status(self, export_id: str, status: str, download_url: str | None, file_path: str | None, error_message: str | None = None) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "UPDATE exports SET status = ?, download_url = ?, file_path = ?, error_message = ? WHERE export_id = ?",
                    (status, download_url, file_path, error_message, export_id),
                )
                conn.commit()
            finally:
                conn.close()

    def get_export(self, export_id: str):
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT export_id, status, download_url, file_path, error_message FROM exports WHERE export_id = ?",
                (export_id,),
            ).fetchone()
            return row
        finally:
            conn.close()


class ExportBuilder:
    def __init__(self, state: AppState):
        self.state = state

    @staticmethod
    def _clamp01(value: float) -> float:
        return max(0.0, min(1.0, value))

    @staticmethod
    def _star_points(x1: int, y1: int, x2: int, y2: int) -> list[tuple[int, int]]:
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0
        rx = max(1.0, (x2 - x1) / 2.0)
        ry = max(1.0, (y2 - y1) / 2.0)
        points: list[tuple[int, int]] = []
        # 10-point polygon alternating outer/inner vertices to form a 5-point star.
        for i in range(10):
            angle = -math.pi / 2 + i * math.pi / 5
            radius_scale = 1.0 if i % 2 == 0 else 0.45
            px = int(cx + math.cos(angle) * rx * radius_scale)
            py = int(cy + math.sin(angle) * ry * radius_scale)
            points.append((px, py))
        return points

    def _draw_shape(self, draw: ImageDraw.ImageDraw, kind: str, x1: int, y1: int, x2: int, y2: int) -> None:
        outline_main = (212, 45, 45)
        outline_subtle = (255, 255, 255)

        shape_kind = kind if kind in {"rect", "circle", "diamond", "star"} else "rect"
        if shape_kind == "rect":
            draw.rectangle([(x1, y1), (x2, y2)], outline=outline_main, width=4)
            draw.rectangle([(x1, y1), (x2, y2)], outline=outline_subtle, width=1)
            return

        if shape_kind == "circle":
            draw.ellipse([(x1, y1), (x2, y2)], outline=outline_main, width=4)
            draw.ellipse([(x1, y1), (x2, y2)], outline=outline_subtle, width=1)
            return

        if shape_kind == "diamond":
            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2
            points = [(cx, y1), (x2, cy), (cx, y2), (x1, cy)]
            draw.polygon(points, outline=outline_main, width=4)
            draw.polygon(points, outline=outline_subtle, width=1)
            return

        points = self._star_points(x1, y1, x2, y2)
        draw.polygon(points, outline=outline_main, width=4)
        draw.polygon(points, outline=outline_subtle, width=1)

    def _apply_annotations(self, image: Image.Image, page_annotations: list[dict]) -> Image.Image:
        draw = ImageDraw.Draw(image)
        width, height = image.size
        for ann in page_annotations:
            kind = str(ann.get("kind", "rect"))
            try:
                x = self._clamp01(float(ann.get("x", 0)))
                y = self._clamp01(float(ann.get("y", 0)))
                w = self._clamp01(float(ann.get("width", ann.get("w", 0))))
                h = self._clamp01(float(ann.get("height", ann.get("h", 0))))
            except (TypeError, ValueError):
                continue

            x1 = int(x * width)
            y1 = int(y * height)
            x2 = int(min(1.0, x + w) * width)
            y2 = int(min(1.0, y + h) * height)

            if x2 <= x1 or y2 <= y1:
                continue

            self._draw_shape(draw, kind, x1, y1, x2, y2)

        return image

    def _page_image_path(self, document_id: str, page_num: int) -> Path:
        return self.state.page_root / document_id / f"page_{page_num}.jpg"

    def build(self, export_id: str, document_id: str, page_count: int, fmt: str, annotations: list[dict], base_url: str) -> str:
        export_dir = self.state.export_root / export_id
        export_dir.mkdir(parents=True, exist_ok=True)

        annotated_paths: list[Path] = []
        for page_num in range(1, page_count + 1):
            src = self._page_image_path(document_id, page_num)
            if not src.exists():
                raise RuntimeError(f"missing rendered page image: {src}")

            with Image.open(src) as raw_img:
                img = raw_img.convert("RGB")
            page_annotations = [a for a in annotations if int(a.get("page", -1)) == page_num]
            img = self._apply_annotations(img, page_annotations)

            out_path = export_dir / f"page_{page_num}.jpg"
            img.save(out_path, "JPEG", quality=92)
            annotated_paths.append(out_path)

        if fmt == "jpg_zip":
            zip_path = export_dir / f"{export_id}.zip"
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for idx, path in enumerate(annotated_paths, start=1):
                    zf.write(path, arcname=f"page_{idx}.jpg")
            return f"{base_url}/v1/exports/{export_id}/download"

        if fmt == "pdf":
            pdf_path = export_dir / f"{export_id}.pdf"
            pil_images: list[Image.Image] = []
            for path in annotated_paths:
                with Image.open(path) as raw_img:
                    pil_images.append(raw_img.convert("RGB"))
            try:
                first, rest = pil_images[0], pil_images[1:]
                first.save(pdf_path, "PDF", save_all=True, append_images=rest)
            finally:
                for image in pil_images:
                    image.close()
            return f"{base_url}/v1/exports/{export_id}/download"

        raise RuntimeError("unsupported export format")


def _is_valid_pdf_upload(filename: str, content_type: str) -> bool:
    if filename.lower().endswith(".pdf"):
        return True
    return "pdf" in content_type.lower()


def _render_pdf_pages_to_jpg(file_bytes: bytes, page_dir: Path) -> int:
    page_dir.mkdir(parents=True, exist_ok=True)
    pdf = pdfium.PdfDocument(file_bytes)
    try:
        page_count = len(pdf)
        for index in range(page_count):
            page = pdf[index]
            try:
                image = page.render(scale=2.0).to_pil()
                out_path = page_dir / f"page_{index + 1}.jpg"
                image.convert("RGB").save(out_path, "JPEG", quality=90)
            finally:
                page.close()
        return page_count
    finally:
        pdf.close()


def create_app(db_path: str | None = None) -> Flask:
    app = Flask(__name__)
    app.config["JSON_SORT_KEYS"] = False

    backend_dir = Path(__file__).resolve().parent
    data_dir = backend_dir / "data"
    db_default = str(data_dir / "app_state.db")
    state = AppState(db_path or os.environ.get("APP_DB_PATH", db_default), data_dir)
    exporter = ExportBuilder(state)

    @app.after_request
    def add_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, If-Match, X-Page-Count"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return response

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok"}), 200

    @app.route("/v1/documents", methods=["OPTIONS"])
    @app.route("/v1/documents/<path:_>", methods=["OPTIONS"])
    @app.route("/v1/exports/<path:_>", methods=["OPTIONS"])
    def options_handler(_=None):
        return ("", 204)

    def require_auth():
        auth = request.headers.get("Authorization", "").strip()
        if not auth:
            return jsonify({"error": "unauthorized"}), 401
        return None

    @app.route("/v1/documents", methods=["POST"])
    def upload_document():
        auth_error = require_auth()
        if auth_error:
            return auth_error

        file = request.files.get("file")
        if file is None:
            return jsonify({"error": "missing_file"}), 400

        content_type = file.content_type or ""
        if not _is_valid_pdf_upload(file.filename or "", content_type):
            return jsonify({"error": "unsupported_media_type"}), 415

        file_bytes = file.read()
        if len(file_bytes) > MAX_FILE_SIZE_MB * 1024 * 1024:
            return jsonify({"error": "file_too_large"}), 413

        temp_doc_id = f"doc_{uuid.uuid4().hex[:12]}"
        doc_upload_dir = state.upload_root / temp_doc_id
        doc_page_dir = state.page_root / temp_doc_id
        doc_upload_dir.mkdir(parents=True, exist_ok=True)

        source_pdf_path = doc_upload_dir / "source.pdf"
        source_pdf_path.write_bytes(file_bytes)

        try:
            page_count = _render_pdf_pages_to_jpg(file_bytes, doc_page_dir)
        except Exception:
            return jsonify({"error": "invalid_pdf"}), 400

        if page_count < 1:
            return jsonify({"error": "invalid_pdf"}), 400

        if page_count > MAX_PAGE_COUNT:
            return jsonify({"error": "page_count_exceeds_limit"}), 413

        # Create canonical record with a stable document ID and move rendered artifacts.
        document = state.create_document(page_count, str(source_pdf_path))
        document_id = document["document_id"]

        canonical_upload_dir = state.upload_root / document_id
        canonical_page_dir = state.page_root / document_id
        canonical_upload_dir.mkdir(parents=True, exist_ok=True)
        canonical_page_dir.mkdir(parents=True, exist_ok=True)

        (canonical_upload_dir / "source.pdf").write_bytes(file_bytes)
        for page_file in sorted(doc_page_dir.glob("page_*.jpg")):
            (canonical_page_dir / page_file.name).write_bytes(page_file.read_bytes())

        # Cleanup temporary dirs.
        for p in doc_page_dir.glob("*"):
            p.unlink(missing_ok=True)
        doc_page_dir.rmdir()
        for p in doc_upload_dir.glob("*"):
            p.unlink(missing_ok=True)
        doc_upload_dir.rmdir()

        preview_urls = [f"/v1/documents/{document_id}/pages/{i}.jpg" for i in range(1, page_count + 1)]
        return jsonify({**document, "preview_urls": preview_urls}), 201

    @app.route("/v1/documents/<document_id>/pages/<int:page_number>.jpg", methods=["GET"])
    def get_page_preview(document_id: str, page_number: int):
        if not DOC_ID_PATTERN.match(document_id):
            return jsonify({"error": "document_not_found"}), 404

        if page_number < 1:
            return jsonify({"error": "page_not_found"}), 404

        page_path = state.page_root / document_id / f"page_{page_number}.jpg"
        if not page_path.exists():
            return jsonify({"error": "page_not_found"}), 404

        return send_file(page_path, mimetype="image/jpeg")

    @app.route("/v1/documents/<document_id>/annotations", methods=["POST"])
    def save_annotations(document_id: str):
        auth_error = require_auth()
        if auth_error:
            return auth_error

        annotation_version = request.headers.get("If-Match", "").strip()
        if not annotation_version:
            return jsonify({"error": "missing_if_match"}), 400

        doc = state.get_document(document_id)
        if doc is None:
            return jsonify({"error": "document_not_found"}), 404

        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({"error": "invalid_json"}), 400

        annotations = body.get("annotations")
        page_ids = body.get("page_ids")
        if not isinstance(annotations, list) or not isinstance(page_ids, list):
            return jsonify({"error": "invalid_payload"}), 400
        if any(not isinstance(p, int) for p in page_ids):
            return jsonify({"error": "invalid_page_ids"}), 400

        max_page = int(doc["page_count"])
        if any(p < 1 or p > max_page for p in page_ids):
            return jsonify({"error": "page_out_of_range"}), 400

        out = state.save_annotations(document_id, annotation_version, page_ids, annotations)
        return jsonify(out), 200

    @app.route("/v1/documents/<document_id>/exports", methods=["POST"])
    def create_export(document_id: str):
        auth_error = require_auth()
        if auth_error:
            return auth_error

        doc = state.get_document(document_id)
        if doc is None:
            return jsonify({"error": "document_not_found"}), 404

        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({"error": "invalid_json"}), 400

        fmt = body.get("format")
        annotation_version = body.get("annotation_version")
        if fmt not in {"pdf", "jpg_zip"}:
            return jsonify({"error": "invalid_format"}), 400
        if not isinstance(annotation_version, str) or not annotation_version.strip():
            return jsonify({"error": "invalid_annotation_version"}), 400

        if not state.has_annotation_version(document_id, annotation_version):
            return jsonify({"error": "annotation_version_not_found"}), 409

        export_ref = state.create_export(document_id, fmt, annotation_version)
        export_id = export_ref["export_id"]

        annotation_bundle = state.get_annotations(document_id, annotation_version)
        if annotation_bundle is None:
            state.update_export_status(export_id, "failed", None, None, "annotation payload missing")
            return jsonify(export_ref), 202

        try:
            base_url = request.host_url.rstrip("/")
            download_url = exporter.build(
                export_id=export_id,
                document_id=document_id,
                page_count=int(doc["page_count"]),
                fmt=fmt,
                annotations=annotation_bundle["annotations"],
                base_url=base_url,
            )
            file_path = str((state.export_root / export_id / f"{export_id}.pdf") if fmt == "pdf" else (state.export_root / export_id / f"{export_id}.zip"))
            state.update_export_status(export_id, "complete", download_url, file_path)
        except Exception as exc:
            state.update_export_status(export_id, "failed", None, None, str(exc))

        return jsonify(export_ref), 202

    @app.route("/v1/exports/<export_id>", methods=["GET"])
    def get_export(export_id: str):
        auth_error = require_auth()
        if auth_error:
            return auth_error

        exp = state.get_export(export_id)
        if exp is None:
            return jsonify({"error": "export_not_found"}), 404

        return (
            jsonify(
                {
                    "export_id": exp["export_id"],
                    "status": exp["status"],
                    "download_url": exp["download_url"],
                    "error": exp["error_message"],
                }
            ),
            200,
        )

    @app.route("/v1/exports/<export_id>/download", methods=["GET"])
    def download_export(export_id: str):
        if not EXPORT_ID_PATTERN.match(export_id):
            return jsonify({"error": "export_not_found"}), 404

        exp = state.get_export(export_id)
        if exp is None:
            return jsonify({"error": "export_not_found"}), 404

        if exp["status"] != "complete" or not exp["file_path"]:
            return jsonify({"error": "export_not_ready"}), 409

        file_path = Path(exp["file_path"])
        if not file_path.exists():
            return jsonify({"error": "export_missing"}), 404

        mimetype = "application/pdf" if file_path.suffix == ".pdf" else "application/zip"
        return send_file(file_path, mimetype=mimetype, as_attachment=True, download_name=file_path.name)

    return app


if __name__ == "__main__":
    host = os.environ.get("APP_HOST", "127.0.0.1")
    port = int(os.environ.get("APP_PORT", "5050"))
    app = create_app()
    app.run(host=host, port=port, debug=False)
