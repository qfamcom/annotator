import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

type UploadResponse = { document_id: string; page_count: number; state: string; preview_urls?: string[] };
type AnnotationResponse = { document_id: string; annotation_version: string; saved_page_ids: number[] };
type DownloadCreateResponse = { export_id: string; status: string };
type DownloadStatusResponse = { export_id: string; status: string; download_url: string | null; error?: string | null };

type AnnotationKind = 'rect' | 'circle' | 'diamond' | 'star';
type VisualAnnotation = {
  id: string;
  kind: AnnotationKind;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  apiBase = 'http://127.0.0.1:5050';
  bearerToken = 'localtest';

  selectedFile: File | null = null;
  uploadingDocument = false;
  private pendingUploadFile: File | null = null;
  uploadedPageCount = 0;
  pagePreviewUrls: string[] = [];
  currentPage = 1;
  documentId = '';

  annotationVersion = 'v1';
  pageIdsInput = '';
  annotationsJson = '[]';
  selectedShape: AnnotationKind = 'rect';

  annotations: VisualAnnotation[] = [];
  draftRect: VisualAnnotation | null = null;
  drawing = false;
  selectedAnnotationId = '';
  draggingAnnotationId = '';
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private drawStartX = 0;
  private drawStartY = 0;

  downloadId = '';
  downloadUrl = '';
  preparingDownload = false;
  private downloadTaskToken = 0;
  savingAnnotations = false;

  statusText = 'Ready';
  responsePanel = '';

  constructor(private http: HttpClient) {}

  async onFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const picked = input.files && input.files.length > 0 ? input.files[0] : null;
    this.selectedFile = picked;
    if (picked) {
      this.pendingUploadFile = picked;
      if (this.uploadingDocument) {
        this.statusText = `Upload in progress. Queued ${picked.name}.`;
      } else {
        await this.processUploadQueue();
      }
      // Allow selecting the same file again to trigger change.
      input.value = '';
    }
  }

  private async processUploadQueue(): Promise<void> {
    while (this.pendingUploadFile) {
      const next = this.pendingUploadFile;
      this.pendingUploadFile = null;
      await this.uploadDocument(next);
    }
  }

  totalPages(): number {
    return Math.max(1, this.uploadedPageCount);
  }

  availablePages(): number[] {
    return Array.from({ length: Math.max(1, this.totalPages()) }, (_, i) => i + 1);
  }

  currentPageAnnotations(): VisualAnnotation[] {
    return this.annotations.filter((a) => Number(a.page) === Number(this.currentPage));
  }

  hasVisualAnnotations(): boolean {
    return this.annotations.length > 0;
  }

  currentPageImageUrl(): string {
    const idx = this.currentPage - 1;
    if (idx < 0 || idx >= this.pagePreviewUrls.length) {
      return '';
    }
    return this.pagePreviewUrls[idx];
  }

  private resolveApiUrl(url: string): string {
    if (!url) {
      return '';
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${this.apiBase}${url}`;
  }

  private authHeaders(extra: Record<string, string> = {}): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${this.bearerToken}`,
      ...extra
    });
  }

  private setResponse(label: string, data: unknown): void {
    this.responsePanel = `${label}\n${JSON.stringify(data, null, 2)}`;
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private toNormalizedPoint(evt: PointerEvent, surface: HTMLElement): { x: number; y: number } {
    const rect = surface.getBoundingClientRect();
    const x = this.clamp01((evt.clientX - rect.left) / rect.width);
    const y = this.clamp01((evt.clientY - rect.top) / rect.height);
    return { x, y };
  }

  private findAnnotation(annotationId: string): VisualAnnotation | undefined {
    return this.annotations.find((a) => a.id === annotationId);
  }

  private setAnnotationPosition(annotationId: string, x: number, y: number): void {
    this.annotations = this.annotations.map((a) => {
      if (a.id !== annotationId) {
        return a;
      }
      return {
        ...a,
        x: this.clamp01(Math.min(x, 1 - a.w)),
        y: this.clamp01(Math.min(y, 1 - a.h))
      };
    });
  }

  isSelected(annotationId: string): boolean {
    return this.selectedAnnotationId === annotationId;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private syncPayloadFromVisualAnnotations(): void {
    const sorted = [...this.annotations].sort((a, b) => (a.page === b.page ? a.id.localeCompare(b.id) : a.page - b.page));
    const payload = sorted.map((a) => ({
      kind: a.kind,
      page: Number(a.page),
      x: Number(a.x.toFixed(4)),
      y: Number(a.y.toFixed(4)),
      width: Number(a.w.toFixed(4)),
      height: Number(a.h.toFixed(4))
    }));

    const pages = Array.from(new Set(sorted.map((a) => Number(a.page)))).sort((a, b) => a - b);

    this.annotationsJson = JSON.stringify(payload, null, 2);
    this.pageIdsInput = pages.join(',');
  }

  onAnnotationPointerDown(evt: PointerEvent, surface: HTMLElement, annotationId: string): void {
    evt.stopPropagation();
    if (!this.documentId) {
      return;
    }

    const ann = this.findAnnotation(annotationId);
    if (!ann) {
      return;
    }

    const p = this.toNormalizedPoint(evt, surface);
    this.selectedAnnotationId = annotationId;
    this.draggingAnnotationId = annotationId;
    this.drawing = false;
    this.draftRect = null;
    this.dragOffsetX = p.x - ann.x;
    this.dragOffsetY = p.y - ann.y;
  }

  onSurfacePointerDown(evt: PointerEvent, surface: HTMLElement): void {
    if (!this.documentId) {
      this.statusText = 'Upload a document before annotating.';
      return;
    }

    const p = this.toNormalizedPoint(evt, surface);
    this.selectedAnnotationId = '';
    this.draggingAnnotationId = '';
    this.drawing = true;
    this.drawStartX = p.x;
    this.drawStartY = p.y;
    this.draftRect = {
      id: 'draft',
      kind: this.selectedShape,
      page: Number(this.currentPage),
      x: p.x,
      y: p.y,
      w: 0,
      h: 0
    };
  }

  onSurfacePointerMove(evt: PointerEvent, surface: HTMLElement): void {
    if (this.draggingAnnotationId) {
      const ann = this.findAnnotation(this.draggingAnnotationId);
      if (!ann) {
        return;
      }
      const p = this.toNormalizedPoint(evt, surface);
      this.setAnnotationPosition(this.draggingAnnotationId, p.x - this.dragOffsetX, p.y - this.dragOffsetY);
      return;
    }

    if (!this.drawing || !this.draftRect) {
      return;
    }

    const p = this.toNormalizedPoint(evt, surface);
    const x = Math.min(this.drawStartX, p.x);
    const y = Math.min(this.drawStartY, p.y);
    const w = Math.abs(p.x - this.drawStartX);
    const h = Math.abs(p.y - this.drawStartY);

    this.draftRect = {
      ...this.draftRect,
      x,
      y,
      w,
      h
    };
  }

  onSurfacePointerUp(): void {
    if (this.draggingAnnotationId) {
      this.draggingAnnotationId = '';
      this.syncPayloadFromVisualAnnotations();
      return;
    }

    if (!this.drawing || !this.draftRect) {
      return;
    }

    this.drawing = false;
    const r = this.draftRect;
    this.draftRect = null;

    if (r.w < 0.005 || r.h < 0.005) {
      return;
    }

    this.annotations.push({
      ...r,
      id: `ann_${crypto.randomUUID()}`
    });
    this.selectedAnnotationId = this.annotations[this.annotations.length - 1]?.id ?? '';
    this.syncPayloadFromVisualAnnotations();
  }

  onSurfacePointerLeave(): void {
    if (this.drawing || this.draggingAnnotationId) {
      this.onSurfacePointerUp();
    }
  }

  selectPage(page: number): void {
    const parsed = Number(page);
    this.currentPage = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  clearCurrentPageAnnotations(): void {
    this.annotations = this.annotations.filter((a) => a.page !== this.currentPage);
    if (!this.findAnnotation(this.selectedAnnotationId)) {
      this.selectedAnnotationId = '';
    }
    this.syncPayloadFromVisualAnnotations();
  }

  clearAllAnnotations(): void {
    this.annotations = [];
    this.annotationsJson = '[]';
    this.pageIdsInput = '';
    this.selectedAnnotationId = '';
    this.draggingAnnotationId = '';
    this.statusText = 'Cleared all visual annotations.';
  }

  async uploadDocument(fileOverride?: File): Promise<void> {
    const uploadFile = fileOverride ?? this.selectedFile;
    if (!uploadFile) {
      this.statusText = 'Select a PDF file before upload.';
      return;
    }
    if (this.uploadingDocument) {
      return;
    }

    // Cancel any in-flight download preparation linked to older state.
    this.downloadTaskToken += 1;
    this.preparingDownload = false;

    this.uploadingDocument = true;
    this.statusText = `Uploading ${uploadFile.name}...`;

    const form = new FormData();
    form.append('file', uploadFile, uploadFile.name);

    try {
      const headers = this.authHeaders();
      const resp = await firstValueFrom(this.http.post<UploadResponse>(`${this.apiBase}/v1/documents`, form, { headers }));
      this.documentId = resp.document_id;
      this.uploadedPageCount = resp.page_count;
      this.currentPage = 1;
      this.pagePreviewUrls = (resp.preview_urls ?? []).map((u) => this.resolveApiUrl(u));
      this.annotations = [];
      this.draftRect = null;
      this.selectedAnnotationId = '';
      this.draggingAnnotationId = '';
      this.annotationsJson = '[]';
      this.pageIdsInput = '';
      this.downloadId = '';
      this.downloadUrl = '';
      this.preparingDownload = false;
      this.statusText = `Upload succeeded: ${resp.document_id}`;
      this.setResponse('UPLOAD', resp);
    } catch (err: any) {
      this.statusText = 'Upload failed';
      this.setResponse('UPLOAD_ERROR', err?.error ?? err?.message ?? err);
    } finally {
      this.uploadingDocument = false;
      if (!this.uploadingDocument && this.pendingUploadFile) {
        await this.processUploadQueue();
      }
    }
  }

  async saveAnnotations(): Promise<void> {
    if (!this.documentId) {
      this.statusText = 'Upload a document first.';
      return;
    }
    if (this.uploadingDocument) {
      this.statusText = 'Upload in progress. Wait before saving annotations.';
      return;
    }

    const saveForDocumentId = this.documentId;

    let annotations: unknown;
    try {
      annotations = JSON.parse(this.annotationsJson);
    } catch {
      this.statusText = 'Annotations JSON is invalid.';
      return;
    }

    const pageIds = this.pageIdsInput
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (pageIds.length === 0) {
      this.statusText = 'No page IDs available. Add visual annotations or enter page IDs manually.';
      return;
    }

    try {
      this.savingAnnotations = true;
      const headers = this.authHeaders({ 'If-Match': this.annotationVersion });
      const body = { annotations, page_ids: pageIds };
      const resp = await firstValueFrom(
        this.http.post<AnnotationResponse>(`${this.apiBase}/v1/documents/${saveForDocumentId}/annotations`, body, { headers })
      );
      if (this.documentId !== saveForDocumentId) {
        return;
      }
      this.statusText = `Annotations saved (${resp.annotation_version}). Preparing downloadable PDF...`;
      this.setResponse('ANNOTATIONS', resp);
      await this.prepareDownloadPdf(saveForDocumentId);
    } catch (err: any) {
      if (this.documentId !== saveForDocumentId) {
        return;
      }
      this.statusText = 'Annotation save failed';
      this.setResponse('ANNOTATIONS_ERROR', err?.error ?? err?.message ?? err);
    } finally {
      this.savingAnnotations = false;
    }
  }

  private async prepareDownloadPdf(documentId: string): Promise<void> {
    const myTaskToken = ++this.downloadTaskToken;
    this.preparingDownload = true;
    this.downloadId = '';
    this.downloadUrl = '';
    try {
      const headers = this.authHeaders();
      const createBody = { format: 'pdf', annotation_version: this.annotationVersion };
      const created = await firstValueFrom(
        this.http.post<DownloadCreateResponse>(`${this.apiBase}/v1/documents/${documentId}/exports`, createBody, { headers })
      );
      if (myTaskToken !== this.downloadTaskToken || this.documentId !== documentId) {
        return;
      }
      this.downloadId = created.export_id;

      for (let i = 0; i < 16; i += 1) {
        const status = await firstValueFrom(
          this.http.get<DownloadStatusResponse>(`${this.apiBase}/v1/exports/${this.downloadId}`, { headers })
        );
        if (myTaskToken !== this.downloadTaskToken || this.documentId !== documentId) {
          return;
        }
        if (status.status === 'complete' && status.download_url) {
          this.downloadUrl = this.resolveApiUrl(status.download_url);
          this.statusText = 'Annotated PDF is ready to download.';
          this.setResponse('DOWNLOAD_STATUS', status);
          return;
        }
        if (status.status === 'failed') {
          this.statusText = 'Download preparation failed.';
          this.setResponse('DOWNLOAD_STATUS_ERROR', status);
          return;
        }
        await this.sleep(400);
      }

      this.statusText = 'Download is still processing. Save again if needed.';
    } catch (err: any) {
      if (myTaskToken !== this.downloadTaskToken || this.documentId !== documentId) {
        return;
      }
      this.statusText = 'Download request failed';
      this.setResponse('DOWNLOAD_CREATE_ERROR', err?.error ?? err?.message ?? err);
    } finally {
      if (myTaskToken === this.downloadTaskToken) {
        this.preparingDownload = false;
      }
    }
  }

  downloadAnnotatedFile(): void {
    if (!this.downloadUrl) {
      this.statusText = 'No downloadable URL yet.';
      return;
    }
    window.location.href = this.downloadUrl;
  }
}
