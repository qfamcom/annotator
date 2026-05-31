import { of, Subject } from 'rxjs';
import { App } from './app';

type HttpMock = {
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
};

function configureRuntime(apiBase = 'https://api.example.test', bearerToken = 'demo-token'): void {
  window.ANNOTATOR_CONFIG = { apiBase, bearerToken };
  delete window.__ANNOTATOR_CONFIG__;
}

function createApp(http?: Partial<HttpMock>): App {
  configureRuntime();
  return new App({ post: vi.fn(), get: vi.fn(), ...http } as any);
}

function makePdf(name = 'sample.pdf'): File {
  return new File(['%PDF-1.7'], name, { type: 'application/pdf' });
}

function makeSurface(surface: { width: number; height: number }, image: { width: number; height: number }): HTMLElement {
  return {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: surface.width, height: surface.height }),
    querySelector: () => ({ naturalWidth: image.width, naturalHeight: image.height })
  } as unknown as HTMLElement;
}

describe('App', () => {
  afterEach(() => {
    delete window.ANNOTATOR_CONFIG;
    delete window.__ANNOTATOR_CONFIG__;
  });

  it('loads runtime config and reports a missing API URL', () => {
    window.ANNOTATOR_CONFIG = { bearerToken: 'token-only' };
    const app = new App({ post: vi.fn(), get: vi.fn() } as any);

    expect(app.apiBase).toBe('');
    expect(app.configError).toContain('API URL is missing');
    expect(app.configError).toContain('window.ANNOTATOR_CONFIG.apiBase');
    expect(app.canUseConfiguredApi()).toBe(false);
  });

  it('still supports the legacy __ANNOTATOR_CONFIG__ runtime config name', () => {
    window.__ANNOTATOR_CONFIG__ = { apiBase: 'https://legacy-api.example.test/', bearerToken: 'legacy-token' };
    const app = new App({ post: vi.fn(), get: vi.fn() } as any);

    expect(app.apiBase).toBe('https://legacy-api.example.test');
    expect(app.bearerToken).toBe('legacy-token');
    expect(app.canUseConfiguredApi()).toBe(true);
  });

  it('rejects invalid files client-side without POSTing to documents', async () => {
    const http = { post: vi.fn(), get: vi.fn() };
    const app = createApp(http);
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [new File(['not pdf'], 'invalid_file.txt', { type: 'text/plain' })] });

    await app.onFileChange({ target: input } as any);

    expect(app.statusText).toBe('Only PDF files are supported.');
    expect(app.selectedFile).toBeNull();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('uses latest-selection-wins upload tokens and suppresses stale upload success', async () => {
    const uploadA = new Subject<any>();
    const uploadB = new Subject<any>();
    const http = {
      post: vi.fn().mockReturnValueOnce(uploadA.asObservable()).mockReturnValueOnce(uploadB.asObservable()),
      get: vi.fn()
    };
    const app = createApp(http);

    const first = app.uploadDocument(makePdf('a.pdf'), 1);
    const second = app.uploadDocument(makePdf('b.pdf'), 2);

    uploadA.next({ document_id: 'doc_aaaaaaaaaaaa', page_count: 1, state: 'uploaded', preview_urls: ['/a.jpg'] });
    uploadA.complete();
    await first;
    expect(app.documentId).toBe('');
    expect(app.pagePreviewUrls).toEqual([]);
    expect(app.responsePanel).toBe('');

    uploadB.next({ document_id: 'doc_bbbbbbbbbbbb', page_count: 3, state: 'uploaded', preview_urls: ['/b1.jpg', '/b2.jpg', '/b3.jpg'] });
    uploadB.complete();
    await second;

    expect(app.documentId).toBe('doc_bbbbbbbbbbbb');
    expect(app.uploadedPageCount).toBe(3);
    expect(app.pagePreviewUrls[0]).toBe('https://api.example.test/b1.jpg');
  });

  it('invalidates a ready export after annotation mutation', () => {
    const app = createApp();
    app.documentId = 'doc_aaaaaaaaaaaa';
    app.annotationVersion = 'v1';
    app.annotationsJson = '[]';
    app.pageIdsInput = '1';
    const signature = app.currentAnnotationSignature();
    (app as any).readyExport = { documentId: app.documentId, annotationVersion: 'v1', signature, exportId: 'exp_aaaaaaaaaaaa', downloadUrl: 'https://api.example.test/dl.pdf' };
    app.downloadId = 'exp_aaaaaaaaaaaa';
    app.downloadUrl = 'https://api.example.test/dl.pdf';

    expect(app.isDownloadCurrent()).toBe(true);

    app.onAnnotationsJsonChange('[{"page":1}]');

    expect(app.downloadUrl).toBe('');
    expect(app.downloadId).toBe('');
    expect(app.isDownloadCurrent()).toBe(false);
  });

  it('uses the saved annotation version response when creating an export', async () => {
    const http = {
      post: vi.fn(),
      get: vi.fn()
    };
    http.post
      .mockReturnValueOnce(of({ document_id: 'doc_aaaaaaaaaaaa', annotation_version: 'server-v2', saved_page_ids: [1] }))
      .mockReturnValueOnce(of({ export_id: 'exp_aaaaaaaaaaaa', status: 'processing' }));
    http.get.mockReturnValue(of({ export_id: 'exp_aaaaaaaaaaaa', status: 'complete', download_url: '/v1/exports/exp_aaaaaaaaaaaa/download' }));
    const app = createApp(http);
    app.documentId = 'doc_aaaaaaaaaaaa';
    app.annotationVersion = 'client-v1';
    app.pageIdsInput = '1';
    app.annotationsJson = '[{"kind":"rect","page":1,"x":0.1,"y":0.1,"width":0.2,"height":0.2}]';

    await app.saveAnnotations();

    const saveHeaders = http.post.mock.calls[0][2].headers;
    const exportBody = http.post.mock.calls[1][1];
    expect(saveHeaders.get('If-Match')).toBe('client-v1');
    expect(exportBody.annotation_version).toBe('server-v2');
    expect(app.annotationVersion).toBe('server-v2');
    expect(app.downloadUrl).toBe('https://api.example.test/v1/exports/exp_aaaaaaaaaaaa/download');
  });

  it('maps coordinates with no letterboxing', () => {
    const app = createApp();
    const surface = makeSurface({ width: 300, height: 400 }, { width: 300, height: 400 });

    const rect = app.renderedImageRect(surface);
    expect(rect.left).toBe(0);
    expect(rect.top).toBe(0);
    expect(rect.width).toBe(300);
    expect(rect.height).toBe(400);
    expect((app as any).toNormalizedPoint({ clientX: 150, clientY: 200 } as PointerEvent, surface)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('maps coordinates with pillarboxing and rejects horizontal padding', () => {
    const app = createApp();
    const surface = makeSurface({ width: 300, height: 400 }, { width: 100, height: 200 });

    const rect = app.renderedImageRect(surface);
    expect(rect.left).toBe(50);
    expect(rect.top).toBe(0);
    expect(rect.width).toBe(200);
    expect(rect.height).toBe(400);
    expect((app as any).toNormalizedPoint({ clientX: 150, clientY: 200 } as PointerEvent, surface)).toEqual({ x: 0.5, y: 0.5 });
    expect((app as any).toNormalizedPoint({ clientX: 25, clientY: 200 } as PointerEvent, surface)).toBeNull();
  });

  it('maps coordinates with letterboxing and rejects vertical padding', () => {
    const app = createApp();
    const surface = makeSurface({ width: 300, height: 400 }, { width: 100, height: 100 });

    const rect = app.renderedImageRect(surface);
    expect(rect.left).toBe(0);
    expect(rect.top).toBe(50);
    expect(rect.width).toBe(300);
    expect(rect.height).toBe(300);
    expect((app as any).toNormalizedPoint({ clientX: 150, clientY: 200 } as PointerEvent, surface)).toEqual({ x: 0.5, y: 0.5 });
    expect((app as any).toNormalizedPoint({ clientX: 150, clientY: 25 } as PointerEvent, surface)).toBeNull();
  });
});
