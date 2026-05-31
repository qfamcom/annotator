# App Implementation - v0.1.0 Annotation Workflow

Phase: 3 (App Build)

This folder now contains:
- `backend/`: Python Flask API (contract-aligned local backend)
- `frontend/`: Angular UI for upload -> annotate -> download flow

## Backend (Flask)

### One-time setup
```bash
DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib /opt/homebrew/bin/python3.13 -m venv \
  /Users/rikquiao/workspace/annotator_mesh/mesh/app/implementation/backend/.venv

DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib \
  /Users/rikquiao/workspace/annotator_mesh/mesh/app/implementation/backend/.venv/bin/pip install \
  -r /Users/rikquiao/workspace/annotator_mesh/mesh/app/implementation/backend/requirements.txt
```

### Run backend
```bash
/Users/rikquiao/workspace/annotator_mesh/mesh/app/implementation/backend/run_backend.sh
```

Default backend URL: `http://127.0.0.1:5050`

Implemented endpoints:
- `POST /v1/documents`
- `GET /v1/documents/{document_id}/pages/{page_number}.jpg`
- `POST /v1/documents/{document_id}/annotations`
- `POST /v1/documents/{document_id}/exports`
- `GET /v1/exports/{export_id}`
- `GET /v1/exports/{export_id}/download`
- `GET /health`

### Backend tests
```bash
DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib \
  /Users/rikquiao/workspace/annotator_mesh/mesh/app/implementation/backend/.venv/bin/python \
  -m unittest /Users/rikquiao/workspace/annotator_mesh/mesh/app/implementation/backend/test_backend.py -v
```

## Frontend (Angular)

### Run frontend
```bash
cd /Users/rikquiao/workspace/annotator_mesh/mesh/app/implementation/frontend
npm start
```

Default frontend URL (Angular dev server): `http://localhost:4200`

Runtime frontend configuration is loaded from `frontend/public/annotator-config.js` (`window.ANNOTATOR_CONFIG`). Override that file at deploy time to set `apiBase` and `bearerToken`; the checked-in local demo default points at `http://127.0.0.1:5050`. The UI supports:
- PDF upload (page count auto-detected)
- Auto-upload as soon as a PDF file is selected
- PDF-to-JPG page rendering on upload (page previews shown in annotator)
- Visual shape annotation overlay (circle/rectangle/diamond/star)
- Click-to-select and drag-to-move annotations on the page surface
- Annotation save with `If-Match` version
- Automatic PDF download preparation after save, with a single download button once ready

## Notes
- Current backend stores state in local SQLite under `backend/data/`.
- Existing `server.py` is retained as the earlier stdlib prototype; Flask backend is the active path for this stack.
