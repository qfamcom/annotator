import { ChangeDetectorRef, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

type RuntimeConfig = {
  apiBase?: string;
  bearerToken?: string;
};

declare global {
  interface Window {
    ANNOTATOR_CONFIG?: RuntimeConfig;
    __ANNOTATOR_CONFIG__?: RuntimeConfig;
  }
}

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

type NormalizedPoint = { x: number; y: number } | null;
type SaveSnapshot = { documentId: string; annotations: unknown; pageIds: number[]; annotationVersion: string };

type ExportRef = {
  documentId: string;
  annotationVersion: string;
  signature: string;
  exportId: string;
  downloadUrl: string;
};

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  apiBase = '';
  bearerToken = '';
  configError = '';

  selectedFile: File | null = null;
  uploadingDocument = false;
  private uploadRequestSeq = 0;
  private activeUploadToken = 0;
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
  exportStatusUrl = '';
  preparingDownload = false;
  private downloadTaskToken = 0;
  private readyExport: ExportRef | null = null;
  private lastExportRequest: { documentId: string; annotationVersion: string; signature: string; exportId: string } | null = null;
  savingAnnotations = false;

  statusText = 'Ready';
  responsePanel = '';

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {
    this.loadRuntimeConfig();
  }

  private notifyViewStateChanged(): void {
    this.cdr.markForCheck();
  }

  private loadRuntimeConfig(): void {
    const cfg = window.ANNOTATOR_CONFIG ?? window.__ANNOTATOR_CONFIG__ ?? {};
    this.apiBase = (cfg.apiBase ?? '').trim().replace(/\/$/, '');
    this.bearerToken = (cfg.bearerToken ?? '').trim();

    if (!this.apiBase) {
      this.configError = 'Configuration error: API URL is missing. Set window.ANNOTATOR_CONFIG.apiBase in public/annotator-config.js.';
      this.statusText = 'Configuration required before using the annotation app.';
      return;
    }

    if (!this.bearerToken) {
      this.configError = 'Configuration warning: auth token is missing. Upload/save/download requests may be rejected by the API.';
    }
  }

  async onFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const picked = input.files && input.files.length > 0 ? input.files[0] : null;
    this.selectedFile = picked;

    if (picked) {
      if (!this.isPdfFile(picked)) {
        this.selectedFile = null;
        this.statusText = 'Only PDF files are supported.';
        this.setResponse('UPLOAD_VALIDATION_ERROR', { error: 'unsupported_media_type', filename: picked.name });
        input.value = '';
        return;
      }

      const uploadToken = ++this.uploadRequestSeq;
      this.activeUploadToken = uploadToken;
      // Allow selecting the same file again while this upload is still in flight.
      input.value = '';
      await this.uploadDocument(picked, uploadToken);
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

  onPagePreviewLoad(): void {
    // Image load triggers Angular change detection so the overlay layer can be
    // recalculated from the image's natural aspect ratio before the user draws.
  }

  isDownloadCurrent(): boolean {
    const signature = this.currentAnnotationSignature(this.annotationVersion);
    return Boolean(
      this.readyExport &&
        this.downloadUrl &&
        this.readyExport.documentId === this.documentId &&
        this.readyExport.annotationVersion === this.annotationVersion &&
        this.readyExport.signature === signature &&
        this.readyExport.downloadUrl === this.downloadUrl
    );
  }

  canUseConfiguredApi(): boolean {
    return Boolean(this.apiBase);
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
    const headers: Record<string, string> = { ...extra };
    if (this.bearerToken) {
      headers['Authorization'] = `Bearer ${this.bearerToken}`;
    }
    return new HttpHeaders(headers);
  }

  private setResponse(label: string, data: unknown): void {
    this.responsePanel = `${label}\n${JSON.stringify(data, null, 2)}`;
  }

  private apiErrorMessage(err: any): string {
    const code = err?.error?.error ?? err?.error ?? err?.message ?? err;
    const normalized = typeof code === 'string' ? code : '';
    const messages: Record<string, string> = {
      unsupported_media_type: 'Only PDF files are supported.',
      invalid_pdf: 'The selected PDF could not be read. Choose a valid PDF file.',
      file_too_large: 'The selected PDF is too large. Choose a file up to 50MB.',
      page_count_exceeds_limit: 'The selected PDF has too many pages.',
      unauthorized: 'Authentication failed. Check the configured bearer token.',
      missing_file: 'No file was sent to the API.',
      invalid_json: 'Annotations JSON is invalid.',
      invalid_payload: 'Annotation payload is invalid.',
      invalid_page_ids: 'Page IDs must be whole numbers.',
      page_out_of_range: 'One or more annotation pages are outside the uploaded document.',
      annotation_version_not_found: 'The saved annotation version was not found for export.',
      export_not_found: 'The export was not found. Prepare the download again.',
      export_not_ready: 'The export is still processing.'
    };
    return messages[normalized] ?? (normalized ? `Request failed: ${normalized}` : 'Request failed. Please try again.');
  }

  private isPdfFile(file: File): boolean {
    const nameLooksPdf = file.name.toLowerCase().endsWith('.pdf');
    const type = (file.type ?? '').toLowerCase();
    const typeLooksPdf = type === '' || type === 'application/pdf' || type.includes('pdf');
    return nameLooksPdf && typeLooksPdf;
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  renderedImageRect(surface: HTMLElement): DOMRectReadOnly {
    const surfaceRect = surface.getBoundingClientRect();
    const img = surface.querySelector<HTMLImageElement>('img.page-preview');
    const naturalWidth = img?.naturalWidth || 0;
    const naturalHeight = img?.naturalHeight || 0;

    if (!naturalWidth || !naturalHeight) {
      return { left: surfaceRect.left, top: surfaceRect.top, width: surfaceRect.width, height: surfaceRect.height } as DOMRectReadOnly;
    }

    const surfaceRatio = surfaceRect.width / surfaceRect.height;
    const imageRatio = naturalWidth / naturalHeight;
    let width = surfaceRect.width;
    let height = surfaceRect.height;
    let left = surfaceRect.left;
    let top = surfaceRect.top;

    if (imageRatio > surfaceRatio) {
      height = width / imageRatio;
      top += (surfaceRect.height - height) / 2;
    } else {
      width = height * imageRatio;
      left += (surfaceRect.width - width) / 2;
    }

    return { left, top, width, height } as DOMRectReadOnly;
  }


  imageLayerLeftPercent(surface: HTMLElement): number {
    const surfaceRect = surface.getBoundingClientRect();
    if (!surfaceRect.width) {
      return 0;
    }
    const imageRect = this.renderedImageRect(surface);
    return ((imageRect.left - surfaceRect.left) / surfaceRect.width) * 100;
  }

  imageLayerTopPercent(surface: HTMLElement): number {
    const surfaceRect = surface.getBoundingClientRect();
    if (!surfaceRect.height) {
      return 0;
    }
    const imageRect = this.renderedImageRect(surface);
    return ((imageRect.top - surfaceRect.top) / surfaceRect.height) * 100;
  }

  imageLayerWidthPercent(surface: HTMLElement): number {
    const surfaceRect = surface.getBoundingClientRect();
    if (!surfaceRect.width) {
      return 100;
    }
    const imageRect = this.renderedImageRect(surface);
    return (imageRect.width / surfaceRect.width) * 100;
  }

  imageLayerHeightPercent(surface: HTMLElement): number {
    const surfaceRect = surface.getBoundingClientRect();
    if (!surfaceRect.height) {
      return 100;
    }
    const imageRect = this.renderedImageRect(surface);
    return (imageRect.height / surfaceRect.height) * 100;
  }

  private toNormalizedPoint(evt: PointerEvent, surface: HTMLElement): NormalizedPoint {
    const rect = this.renderedImageRect(surface);
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const rawX = (evt.clientX - rect.left) / rect.width;
    const rawY = (evt.clientY - rect.top) / rect.height;
    if (rawX < 0 || rawX > 1 || rawY < 0 || rawY > 1) {
      return null;
    }

    return { x: this.clamp01(rawX), y: this.clamp01(rawY) };
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

  invalidateExport(reason: string): void {
    this.downloadTaskToken += 1;
    this.preparingDownload = false;
    this.downloadId = '';
    this.downloadUrl = '';
    this.exportStatusUrl = '';
    this.readyExport = null;
    this.lastExportRequest = null;
    if (reason) {
      this.statusText = reason;
    }
  }

  currentAnnotationSignature(annotationVersion = this.annotationVersion): string {
    return JSON.stringify({
      documentId: this.documentId,
      annotationVersion,
      pageIdsInput: this.pageIdsInput.trim(),
      annotationsJson: this.annotationsJson.trim()
    });
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

  onAnnotationVersionChange(value: string): void {
    this.annotationVersion = value;
    this.invalidateExport('Annotation version changed. Save annotations to prepare a new download.');
  }

  onPageIdsInputChange(value: string): void {
    this.pageIdsInput = value;
    this.invalidateExport('Page IDs changed. Save annotations to prepare a new download.');
  }

  onAnnotationsJsonChange(value: string): void {
    this.annotationsJson = value;
    this.invalidateExport('Annotations JSON changed. Save annotations to prepare a new download.');
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
    if (!p) {
      return;
    }
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
    if (!p) {
      this.statusText = 'Start drawing inside the rendered PDF page.';
      return;
    }
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
      if (!p) {
        return;
      }
      this.setAnnotationPosition(this.draggingAnnotationId, p.x - this.dragOffsetX, p.y - this.dragOffsetY);
      return;
    }

    if (!this.drawing || !this.draftRect) {
      return;
    }

    const p = this.toNormalizedPoint(evt, surface);
    if (!p) {
      return;
    }
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
      this.invalidateExport('Annotation moved. Save annotations to prepare a new download.');
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
    this.invalidateExport('Annotation added. Save annotations to prepare a new download.');
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
    const before = this.annotations.length;
    this.annotations = this.annotations.filter((a) => a.page !== this.currentPage);
    if (!this.findAnnotation(this.selectedAnnotationId)) {
      this.selectedAnnotationId = '';
    }
    this.syncPayloadFromVisualAnnotations();
    if (this.annotations.length !== before) {
      this.invalidateExport('Page annotations cleared. Save annotations to prepare a new download.');
    }
  }

  clearAllAnnotations(): void {
    this.annotations = [];
    this.annotationsJson = '[]';
    this.pageIdsInput = '';
    this.selectedAnnotationId = '';
    this.draggingAnnotationId = '';
    this.invalidateExport('Cleared all visual annotations. Save annotations to prepare a new download.');
  }

  async uploadDocument(fileOverride?: File, uploadToken = ++this.uploadRequestSeq): Promise<void> {
    const uploadFile = fileOverride ?? this.selectedFile;
    if (!uploadFile) {
      this.statusText = 'Select a PDF file before upload.';
      return;
    }
    if (!this.canUseConfiguredApi()) {
      this.statusText = this.configError || 'API URL is missing.';
      return;
    }
    if (!this.isPdfFile(uploadFile)) {
      this.statusText = 'Only PDF files are supported.';
      this.setResponse('UPLOAD_VALIDATION_ERROR', { error: 'unsupported_media_type', filename: uploadFile.name });
      return;
    }

    this.activeUploadToken = uploadToken;
    this.invalidateExport('New document selected. Existing export was cleared.');
    this.uploadingDocument = true;
    this.statusText = `Uploading ${uploadFile.name}...`;
    this.notifyViewStateChanged();

    const form = new FormData();
    form.append('file', uploadFile, uploadFile.name);

    try {
      const headers = this.authHeaders();
      const resp = await firstValueFrom(this.http.post<UploadResponse>(`${this.apiBase}/v1/documents`, form, { headers }));
      if (uploadToken !== this.activeUploadToken) {
        return;
      }
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
      this.statusText = `Upload succeeded: ${resp.document_id}`;
      this.setResponse('UPLOAD', resp);
      this.notifyViewStateChanged();
    } catch (err: any) {
      if (uploadToken !== this.activeUploadToken) {
        return;
      }
      this.statusText = this.apiErrorMessage(err);
      this.setResponse('UPLOAD_ERROR', err?.error ?? err?.message ?? err);
      this.notifyViewStateChanged();
    } finally {
      if (uploadToken === this.activeUploadToken) {
        this.uploadingDocument = false;
        this.notifyViewStateChanged();
      }
    }
  }

  private createSaveSnapshot(): SaveSnapshot | null {
    const documentId = this.documentId;
    const annotationVersion = this.annotationVersion.trim();
    if (!documentId) {
      this.statusText = 'Upload a document first.';
      return null;
    }
    if (!annotationVersion) {
      this.statusText = 'Annotation version is required.';
      return null;
    }

    let annotations: unknown;
    try {
      annotations = JSON.parse(this.annotationsJson);
    } catch {
      this.statusText = 'Annotations JSON is invalid.';
      return null;
    }

    const pageIds = this.pageIdsInput
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);

    if (pageIds.length === 0) {
      this.statusText = 'No page IDs available. Add visual annotations or enter page IDs manually.';
      return null;
    }

    return { documentId, annotations, pageIds, annotationVersion };
  }

  async saveAnnotations(): Promise<void> {
    if (!this.canUseConfiguredApi()) {
      this.statusText = this.configError || 'API URL is missing.';
      return;
    }
    if (this.uploadingDocument) {
      this.statusText = 'Upload in progress. Wait before saving annotations.';
      return;
    }

    const snapshot = this.createSaveSnapshot();
    if (!snapshot) {
      return;
    }

    try {
      this.savingAnnotations = true;
      const headers = this.authHeaders({ 'If-Match': snapshot.annotationVersion });
      const body = { annotations: snapshot.annotations, page_ids: snapshot.pageIds };
      const resp = await firstValueFrom(
        this.http.post<AnnotationResponse>(`${this.apiBase}/v1/documents/${snapshot.documentId}/annotations`, body, { headers })
      );
      if (this.documentId !== snapshot.documentId) {
        return;
      }
      const savedVersion = resp.annotation_version;
      this.annotationVersion = savedVersion;
      const exportSignature = this.currentAnnotationSignature(savedVersion);
      this.statusText = `Annotations saved (${savedVersion}). Preparing downloadable PDF...`;
      this.setResponse('ANNOTATIONS', resp);
      await this.prepareDownloadPdf(snapshot.documentId, savedVersion, exportSignature);
    } catch (err: any) {
      if (this.documentId !== snapshot.documentId) {
        return;
      }
      this.statusText = this.apiErrorMessage(err);
      this.setResponse('ANNOTATIONS_ERROR', err?.error ?? err?.message ?? err);
    } finally {
      this.savingAnnotations = false;
    }
  }

  private async prepareDownloadPdf(documentId: string, annotationVersion: string, signature: string): Promise<void> {
    const myTaskToken = ++this.downloadTaskToken;
    this.preparingDownload = true;
    this.downloadId = '';
    this.downloadUrl = '';
    this.exportStatusUrl = '';
    this.readyExport = null;
    try {
      const headers = this.authHeaders();
      const createBody = { format: 'pdf', annotation_version: annotationVersion };
      const created = await firstValueFrom(
        this.http.post<DownloadCreateResponse>(`${this.apiBase}/v1/documents/${documentId}/exports`, createBody, { headers })
      );
      if (myTaskToken !== this.downloadTaskToken || this.documentId !== documentId) {
        return;
      }
      this.downloadId = created.export_id;
      this.lastExportRequest = { documentId, annotationVersion, signature, exportId: created.export_id };
      this.exportStatusUrl = `${this.apiBase}/v1/exports/${created.export_id}`;

      const delays = [400, 600, 900, 1300, 1800, 2500, 3500, 5000, 7000, 9000, 12000, 15000, 20000, 25000];
      for (const delayMs of delays) {
        const status = await this.fetchExportStatus(created.export_id, headers);
        if (myTaskToken !== this.downloadTaskToken || this.documentId !== documentId) {
          return;
        }
        if (status.status === 'complete' && status.download_url) {
          const resolvedUrl = this.resolveApiUrl(status.download_url);
          this.downloadUrl = resolvedUrl;
          this.readyExport = { documentId, annotationVersion, signature, exportId: created.export_id, downloadUrl: resolvedUrl };
          this.statusText = 'Annotated PDF is ready to download.';
          this.setResponse('DOWNLOAD_STATUS', status);
          return;
        }
        if (status.status === 'failed') {
          this.statusText = status.error ? `Download preparation failed: ${status.error}` : 'Download preparation failed.';
          this.setResponse('DOWNLOAD_STATUS_ERROR', status);
          return;
        }
        await this.sleep(delayMs);
      }

      this.statusText = 'Download is still processing. Use Refresh Export Status to check again.';
    } catch (err: any) {
      if (myTaskToken !== this.downloadTaskToken || this.documentId !== documentId) {
        return;
      }
      this.statusText = this.apiErrorMessage(err);
      this.setResponse('DOWNLOAD_CREATE_ERROR', err?.error ?? err?.message ?? err);
    } finally {
      if (myTaskToken === this.downloadTaskToken) {
        this.preparingDownload = false;
      }
    }
  }

  private async fetchExportStatus(exportId: string, headers = this.authHeaders()): Promise<DownloadStatusResponse> {
    return await firstValueFrom(this.http.get<DownloadStatusResponse>(`${this.apiBase}/v1/exports/${exportId}`, { headers }));
  }

  async refreshExportStatus(): Promise<void> {
    if (!this.lastExportRequest) {
      this.statusText = 'No export is available to refresh. Save annotations first.';
      return;
    }
    const request = this.lastExportRequest;
    if (request.documentId !== this.documentId || request.signature !== this.currentAnnotationSignature(request.annotationVersion)) {
      this.invalidateExport('Current annotations differ from the export. Save annotations to prepare a new download.');
      return;
    }

    try {
      this.preparingDownload = true;
      const status = await this.fetchExportStatus(request.exportId);
      if (status.status === 'complete' && status.download_url) {
        const resolvedUrl = this.resolveApiUrl(status.download_url);
        this.downloadId = request.exportId;
        this.downloadUrl = resolvedUrl;
        this.readyExport = {
          documentId: request.documentId,
          annotationVersion: request.annotationVersion,
          signature: request.signature,
          exportId: request.exportId,
          downloadUrl: resolvedUrl
        };
        this.statusText = 'Annotated PDF is ready to download.';
        this.setResponse('DOWNLOAD_STATUS', status);
        return;
      }
      if (status.status === 'failed') {
        this.statusText = status.error ? `Download preparation failed: ${status.error}` : 'Download preparation failed.';
        this.setResponse('DOWNLOAD_STATUS_ERROR', status);
        return;
      }
      this.statusText = 'Download is still processing. Refresh again shortly.';
      this.setResponse('DOWNLOAD_STATUS', status);
    } catch (err: any) {
      this.statusText = this.apiErrorMessage(err);
      this.setResponse('DOWNLOAD_STATUS_ERROR', err?.error ?? err?.message ?? err);
    } finally {
      this.preparingDownload = false;
    }
  }

  downloadAnnotatedFile(): void {
    if (!this.isDownloadCurrent()) {
      this.statusText = 'No current downloadable PDF is ready. Save annotations first.';
      return;
    }
    window.location.href = this.downloadUrl;
  }
}
