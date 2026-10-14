import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  Upload,
  Download,
  AlertCircle,
  Lock,
  Sparkles,
  Layers,
  Languages,
  X,
  FileCheck,
  RefreshCw,
  Archive,
} from 'lucide-react';

export type ConversionMode = 'layout' | 'plain-text';
export type OcrMode = 'auto' | 'enabled' | 'disabled';

interface FileUploadItem {
  id: string;
  file: File;
  name: string;
  size: number;
}

interface ServerJobFile {
  fileId: string;
  originalName: string;
  state: 'queued' | 'inspecting' | 'running' | 'needs_password' | 'done' | 'failed' | 'cancelled';
  progress: number;
  stage: string;
  pageCount?: number;
  pagesConverted?: number;
  ocrPages?: number[];
  fileSizeBytes: number;
  needsPassword?: boolean;
  warnings?: { code: string; message: string }[];
  error?: string;
  outputName?: string;
  hasOutput?: boolean;
}

interface ServerJobResponse {
  jobId: string;
  state: string;
  downloadToken?: string;
  files: ServerJobFile[];
  downloadActions?: {
    canDownloadAll: boolean;
    completedFilesCount: number;
    totalFilesCount: number;
  };
}

export const PdfToWordView: React.FC = () => {
  // SEO title and meta description
  useEffect(() => {
    const originalTitle = document.title;
    document.title = 'PDF to Word Converter | AI Video Optimizer';

    let metaDesc = document.querySelector('meta[name="description"]');
    const originalDesc = metaDesc?.getAttribute('content') || '';
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute(
      'content',
      'Convert PDF documents to editable Microsoft Word (DOCX) files with accurate layout preservation, table extraction, and multi-language OCR.'
    );

    return () => {
      document.title = originalTitle;
      if (metaDesc && originalDesc) metaDesc.setAttribute('content', originalDesc);
    };
  }, []);

  // Language toggle (EN / Khmer)
  const [lang, setLang] = useState<'en' | 'kh'>('en');

  // File selection state
  const [selectedFiles, setSelectedFiles] = useState<FileUploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Conversion options
  const [mode, setMode] = useState<ConversionMode>('layout');
  const [ocrMode, setOcrMode] = useState<OcrMode>('auto');
  const [ocrLanguages, setOcrLanguages] = useState<string[]>(['eng', 'khm']);
  const [pageRange, setPageRange] = useState<string>('');

  // Active Job State
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [jobData, setJobData] = useState<ServerJobResponse | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Password retry modal
  const [passwordModalFile, setPasswordModalFile] = useState<ServerJobFile | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);

  // Polling for job updates
  useEffect(() => {
    if (!activeJobId) return;

    let isMounted = true;
    let pollTimeout: NodeJS.Timeout;

    const poll = async () => {
      try {
        const tokenQuery = downloadToken ? `?token=${encodeURIComponent(downloadToken)}` : '';
        const res = await fetch(`/api/tools/pdf-to-word/jobs/${activeJobId}${tokenQuery}`);
        if (!res.ok) {
          if (res.status === 404) {
            if (isMounted) setGlobalError('Conversion job has expired or was removed.');
            return;
          }
          throw new Error(`Failed to fetch job status (${res.status})`);
        }
        const data: ServerJobResponse = await res.json();
        if (isMounted) {
          setJobData(data);

          // Check if any file needs password and open modal automatically
          const needsPwFile = data.files.find((f) => f.needsPassword && f.state === 'needs_password');
          if (needsPwFile && !passwordModalFile) {
            setPasswordModalFile(needsPwFile);
          }

          // Continue polling if job is not terminal
          const isTerminal =
            data.state === 'done' ||
            data.state === 'failed' ||
            data.state === 'cancelled' ||
            data.files.every(
              (f) =>
                f.state === 'done' ||
                f.state === 'failed' ||
                f.state === 'cancelled' ||
                f.state === 'needs_password'
            );

          if (!isTerminal) {
            pollTimeout = setTimeout(poll, 1500);
          }
        }
      } catch (err: any) {
        console.warn('Polling error:', err);
        if (isMounted) {
          pollTimeout = setTimeout(poll, 3000);
        }
      }
    };

    poll();

    return () => {
      isMounted = false;
      clearTimeout(pollTimeout);
    };
  }, [activeJobId, downloadToken, passwordModalFile]);

  // Handle Drag and Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
    }
  };

  const addFiles = (files: File[]) => {
    setGlobalError(null);
    const pdfFiles = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'));

    if (pdfFiles.length < files.length) {
      setGlobalError(
        lang === 'en'
          ? 'Only PDF documents (.pdf) are supported. Non-PDF files were skipped.'
          : 'គាំទ្រតែឯកសារ PDF ប៉ុណ្ណោះ។ ឯកសារមិនមែនជា PDF ត្រូវបានរំលង។'
      );
    }

    if (pdfFiles.length === 0) return;

    setSelectedFiles((prev) => {
      const combined = [...prev];
      for (const f of pdfFiles) {
        if (combined.length >= 10) {
          setGlobalError(
            lang === 'en'
              ? 'Maximum 10 files per conversion batch.'
              : 'អនុញ្ញាតអតិបរមាត្រឹម ១០ ឯកសារក្នុងមួយលើក។'
          );
          break;
        }
        if (!combined.some((item) => item.name === f.name && item.size === f.size)) {
          combined.push({
            id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            file: f,
            name: f.name,
            size: f.size,
          });
        }
      }
      return combined;
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (id: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const clearAllFiles = () => {
    setSelectedFiles([]);
    setGlobalError(null);
  };

  // Start Conversion Job
  const handleStartConversion = async () => {
    if (selectedFiles.length === 0) return;
    setIsUploading(true);
    setGlobalError(null);

    const formData = new FormData();
    for (const item of selectedFiles) {
      formData.append('files', item.file);
    }
    formData.append('mode', mode);
    formData.append('ocrMode', ocrMode);
    formData.append('ocrLanguages', ocrLanguages.join(','));
    if (pageRange.trim()) {
      formData.append('pageRange', pageRange.trim());
    }

    try {
      const res = await fetch('/api/tools/pdf-to-word/jobs', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit conversion job');
      }

      setActiveJobId(data.jobId);
      setDownloadToken(data.downloadToken || null);
      setJobData(data);
    } catch (err: any) {
      setGlobalError(err.message || 'An unexpected error occurred while starting conversion.');
    } finally {
      setIsUploading(false);
    }
  };

  // Cancel Job
  const handleCancelJob = async () => {
    if (!activeJobId) return;
    try {
      const tokenQuery = downloadToken ? `?token=${encodeURIComponent(downloadToken)}` : '';
      await fetch(`/api/tools/pdf-to-word/jobs/${activeJobId}/cancel${tokenQuery}`, {
        method: 'POST',
      });
      setJobData((prev) => (prev ? { ...prev, state: 'cancelled' } : null));
    } catch {}
  };

  // Submit Password for Locked PDF
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeJobId || !passwordModalFile || !passwordInput.trim()) return;

    setIsSubmittingPassword(true);
    setPasswordError(null);

    try {
      const tokenQuery = downloadToken ? `?token=${encodeURIComponent(downloadToken)}` : '';
      const res = await fetch(
        `/api/tools/pdf-to-word/jobs/${activeJobId}/files/${passwordModalFile.fileId}/password${tokenQuery}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: passwordInput }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Incorrect password.');
      }

      setPasswordModalFile(null);
      setPasswordInput('');
    } catch (err: any) {
      setPasswordError(err.message || 'Incorrect password.');
    } finally {
      setIsSubmittingPassword(false);
    }
  };

  // Download Handlers
  const handleDownloadSingle = (fileId: string) => {
    if (!activeJobId) return;
    const tokenQuery = downloadToken ? `?token=${encodeURIComponent(downloadToken)}` : '';
    window.location.href = `/api/tools/pdf-to-word/jobs/${activeJobId}/files/${fileId}/download${tokenQuery}`;
  };

  const handleDownloadAllZip = () => {
    if (!activeJobId) return;
    const tokenQuery = downloadToken ? `?token=${encodeURIComponent(downloadToken)}` : '';
    window.location.href = `/api/tools/pdf-to-word/jobs/${activeJobId}/download-all${tokenQuery}`;
  };

  const handleReset = () => {
    setActiveJobId(null);
    setJobData(null);
    setDownloadToken(null);
    setSelectedFiles([]);
    setGlobalError(null);
    setPasswordModalFile(null);
    setPasswordInput('');
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto py-2">
      {/* Header & Language Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-6">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold uppercase tracking-wider">
            <FileText className="w-3.5 h-3.5" />
            DOCX Converter & OCR
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            {lang === 'en' ? 'PDF to Word' : 'កម្មវិធីបម្លែង PDF ទៅជា Word'}
          </h1>
          <p className="text-sm text-neutral-400">
            {lang === 'en'
              ? 'Convert PDF files into editable Word documents with layout preservation, tables, and Khmer/English OCR.'
              : 'បម្លែងឯកសារ PDF ទៅជាឯកសារ Word (DOCX) ដែលអាចកែសម្រួលបាន ដោយរក្សាប្លង់ តារាង និងស្គាល់អក្សរខ្មែរ/អង់គ្លេស។'}
          </p>
        </div>

        {/* Bilingual Language Switcher */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-neutral-900 border border-white/10 self-start sm:self-auto">
          <Languages className="w-4 h-4 text-neutral-400 ml-2" />
          <button
            onClick={() => setLang('en')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
              lang === 'en' ? 'bg-amber-500 text-neutral-950 shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            English
          </button>
          <button
            onClick={() => setLang('kh')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
              lang === 'kh' ? 'bg-amber-500 text-neutral-950 shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            ភាសាខ្មែរ
          </button>
        </div>
      </div>

      {/* Global Error Banner */}
      {globalError && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">{lang === 'en' ? 'Notice' : 'ដំណឹង'}</p>
            <p className="mt-0.5 text-xs text-red-200/90">{globalError}</p>
          </div>
          <button onClick={() => setGlobalError(null)} className="text-red-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* View 1: Upload & Configure View (When no job is running) */}
      {!activeJobId && (
        <div className="space-y-6">
          {/* Dropzone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`p-8 sm:p-12 rounded-2xl border-2 border-dashed transition-all cursor-pointer text-center flex flex-col items-center justify-center gap-4 ${
              isDragging
                ? 'border-amber-400 bg-amber-500/10 scale-[1.01]'
                : 'border-white/15 bg-neutral-900/50 hover:border-amber-400/50 hover:bg-neutral-900/80'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,application/pdf"
              multiple
              className="hidden"
            />
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
              <Upload className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <p className="text-base sm:text-lg font-bold text-white">
                {lang === 'en'
                  ? 'Drag and drop PDF files here, or click to browse'
                  : 'អូសទម្លាក់ឯកសារ PDF នៅទីនេះ ឬចុចដើម្បីជ្រើសរើស'}
              </p>
              <p className="text-xs text-neutral-400">
                {lang === 'en'
                  ? 'Supports up to 10 PDF files per batch (max 25 MB per document)'
                  : 'គាំទ្ររហូតដល់ ១០ ឯកសារក្នុងមួយលើក (ទំហំអតិបរមា ២៥ MB ក្នុងមួយឯកសារ)'}
              </p>
            </div>
          </div>

          {/* Selected Files List */}
          {selectedFiles.length > 0 && (
            <div className="glass-panel p-5 rounded-2xl border border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-neutral-300 border-b border-white/5 pb-2">
                <span>
                  {lang === 'en' ? 'SELECTED FILES' : 'ឯកសារដែលបានជ្រើសរើស'} ({selectedFiles.length} / 10)
                </span>
                <button
                  onClick={clearAllFiles}
                  className="text-neutral-400 hover:text-red-400 transition-colors"
                >
                  {lang === 'en' ? 'Clear all' : 'សម្អាតទាំងអស់'}
                </button>
              </div>

              <div className="divide-y divide-white/5 max-h-60 overflow-y-auto">
                {selectedFiles.map((item) => (
                  <div key={item.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="truncate font-medium text-white">{item.name}</span>
                      <span className="text-neutral-500 shrink-0 font-mono">
                        ({formatFileSize(item.size)})
                      </span>
                    </div>
                    <button
                      onClick={() => removeFile(item.id)}
                      className="text-neutral-500 hover:text-red-400 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Conversion Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Mode selection */}
            <div className="glass-panel p-5 rounded-2xl border border-white/[0.08] space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300 uppercase tracking-wider">
                <Layers className="w-4 h-4" />
                {lang === 'en' ? 'Conversion Mode' : 'ទម្រង់បម្លែង'}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('layout')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    mode === 'layout'
                      ? 'bg-amber-500/20 border-amber-500/50 text-white'
                      : 'border-white/5 bg-neutral-900/40 text-neutral-400 hover:text-white'
                  }`}
                >
                  <p className="text-xs font-bold">{lang === 'en' ? 'Accurate Layout' : 'ប្លង់ច្បាស់លាស់'}</p>
                  <p className="text-[10px] text-neutral-400 mt-1">
                    {lang === 'en' ? 'Preserves paragraphs, tables & images' : 'រក្សាកថាខណ្ឌ តារាង និងរូបភាព'}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('plain-text')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    mode === 'plain-text'
                      ? 'bg-amber-500/20 border-amber-500/50 text-white'
                      : 'border-white/5 bg-neutral-900/40 text-neutral-400 hover:text-white'
                  }`}
                >
                  <p className="text-xs font-bold">{lang === 'en' ? 'Plain Text' : 'អត្ថបទសុទ្ធ'}</p>
                  <p className="text-[10px] text-neutral-400 mt-1">
                    {lang === 'en' ? 'Clean text flow with page breaks' : 'អត្ថបទស្អាតបែងចែកតាមទំព័រ'}
                  </p>
                </button>
              </div>
            </div>

            {/* OCR Options */}
            <div className="glass-panel p-5 rounded-2xl border border-white/[0.08] space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300 uppercase tracking-wider">
                <Sparkles className="w-4 h-4" />
                {lang === 'en' ? 'OCR Engine (Scanned Pages)' : 'បច្ចេកវិទ្យា OCR (សន្លឹកស្កេន)'}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['auto', 'enabled', 'disabled'] as OcrMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setOcrMode(m)}
                    className={`p-2.5 rounded-xl border text-center transition-all ${
                      ocrMode === m
                        ? 'bg-amber-500/20 border-amber-500/50 text-white'
                        : 'border-white/5 bg-neutral-900/40 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <p className="text-xs font-bold capitalize">{m}</p>
                  </button>
                ))}
              </div>

              {/* OCR Language toggles */}
              {ocrMode !== 'disabled' && (
                <div className="pt-2 border-t border-white/5 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-neutral-400">{lang === 'en' ? 'Languages:' : 'ភាសា:'}</span>
                  <label className="inline-flex items-center gap-1.5 text-xs text-neutral-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ocrLanguages.includes('eng')}
                      onChange={(e) => {
                        if (e.target.checked) setOcrLanguages((prev) => [...prev, 'eng']);
                        else setOcrLanguages((prev) => prev.filter((l) => l !== 'eng'));
                      }}
                      className="rounded border-white/20 bg-neutral-800 text-amber-500 focus:ring-0"
                    />
                    English
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-neutral-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ocrLanguages.includes('khm')}
                      onChange={(e) => {
                        if (e.target.checked) setOcrLanguages((prev) => [...prev, 'khm']);
                        else setOcrLanguages((prev) => prev.filter((l) => l !== 'khm'));
                      }}
                      className="rounded border-white/20 bg-neutral-800 text-amber-500 focus:ring-0"
                    />
                    ភាសាខ្មែរ (Khmer)
                  </label>
                </div>
              )}
            </div>

            {/* Page Range input */}
            <div className="glass-panel p-5 rounded-2xl border border-white/[0.08] space-y-2 md:col-span-2">
              <label className="text-xs font-bold text-neutral-300 flex items-center justify-between">
                <span>{lang === 'en' ? 'Page Range (Optional)' : 'ចន្លោះទំព័រ (មិនទាមទារ)'}</span>
                <span className="text-[10px] text-neutral-500 font-normal">
                  {lang === 'en' ? 'e.g. 1-3, 5, 8-10' : 'ឧទាហរណ៍ 1-3, 5, 8-10'}
                </span>
              </label>
              <input
                type="text"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                placeholder={lang === 'en' ? 'All pages (leave blank) or 1-5' : 'គ្រប់ទំព័រ (ទុកនៅទំនេរ) ឬ 1-5'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-900/90 border border-white/10 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400/50"
              />
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="button"
            disabled={selectedFiles.length === 0 || isUploading}
            onClick={handleStartConversion}
            className={`w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${
              selectedFiles.length > 0 && !isUploading
                ? 'bg-amber-500 hover:bg-amber-400 text-neutral-950 shadow-lg shadow-amber-500/20'
                : 'bg-white/5 text-neutral-500 cursor-not-allowed border border-white/5'
            }`}
          >
            {isUploading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{lang === 'en' ? 'Uploading & Queuing...' : 'កំពុងផ្ទុកឡើង និងរៀបចំជួរ...'}</span>
              </>
            ) : (
              <>
                <FileCheck className="w-4 h-4" />
                <span>
                  {lang === 'en'
                    ? `Convert ${selectedFiles.length} File${selectedFiles.length > 1 ? 's' : ''} to DOCX`
                    : `បម្លែង ${selectedFiles.length} ឯកសារទៅជា DOCX`}
                </span>
              </>
            )}
          </button>
        </div>
      )}

      {/* View 2: Active Job Progress & Results */}
      {activeJobId && jobData && (
        <div className="space-y-6">
          <div className="glass-panel p-6 rounded-2xl border border-white/[0.08] space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>{lang === 'en' ? 'Batch Conversion Status' : 'ស្ថានភាពនៃការបម្លែង'}</span>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase ${
                      jobData.state === 'done'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : jobData.state === 'running'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : jobData.state === 'needs_password'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                        : 'bg-white/10 text-neutral-300'
                    }`}
                  >
                    {jobData.state}
                  </span>
                </h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Job ID: <span className="font-mono text-neutral-300">{jobData.jobId}</span>
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                {jobData.downloadActions?.canDownloadAll && (
                  <button
                    onClick={handleDownloadAllZip}
                    className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition-all"
                  >
                    <Archive className="w-4 h-4" />
                    <span>{lang === 'en' ? 'Download All (ZIP)' : 'ទាញយកទាំងអស់ (ZIP)'}</span>
                  </button>
                )}
                {jobData.state === 'running' && (
                  <button
                    onClick={handleCancelJob}
                    className="px-3 py-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-neutral-400 hover:text-red-300 text-xs font-semibold border border-white/5 transition-all"
                  >
                    {lang === 'en' ? 'Cancel' : 'បោះបង់'}
                  </button>
                )}
                {(jobData.state === 'done' || jobData.state === 'failed' || jobData.state === 'cancelled') && (
                  <button
                    onClick={handleReset}
                    className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition-all"
                  >
                    {lang === 'en' ? 'Convert Another Batch' : 'បម្លែងឯកសារថ្មី'}
                  </button>
                )}
              </div>
            </div>

            {/* Per-File Progress List */}
            <div className="space-y-3">
              {jobData.files.map((file) => {
                const isCompleted = file.state === 'done';
                const isFailed = file.state === 'failed';
                const isWaitingPassword = file.state === 'needs_password';

                return (
                  <div
                    key={file.fileId}
                    className={`p-4 rounded-xl border transition-all ${
                      isCompleted
                        ? 'bg-emerald-500/[0.04] border-emerald-500/20'
                        : isFailed
                        ? 'bg-red-500/[0.04] border-red-500/20'
                        : isWaitingPassword
                        ? 'bg-amber-500/[0.08] border-amber-500/30'
                        : 'bg-neutral-900/60 border-white/5'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <FileText
                            className={`w-4 h-4 shrink-0 ${
                              isCompleted
                                ? 'text-emerald-400'
                                : isFailed
                                ? 'text-red-400'
                                : isWaitingPassword
                                ? 'text-amber-400'
                                : 'text-neutral-400'
                            }`}
                          />
                          <p className="text-xs font-bold text-white truncate">{file.originalName}</p>
                          {file.pageCount && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-neutral-400">
                              {file.pagesConverted || file.pageCount} pgs
                            </span>
                          )}
                        </div>

                        {/* Stage / Progress indicator */}
                        <p className="text-[11px] text-neutral-400 flex items-center gap-1.5">
                          {file.state === 'running' && <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />}
                          {file.stage}
                          {file.error && <span className="text-red-400 font-medium">— {file.error}</span>}
                        </p>
                      </div>

                      {/* Download or Unlock button */}
                      <div className="flex items-center gap-2 shrink-0">
                        {isWaitingPassword && (
                          <button
                            onClick={() => {
                              setPasswordModalFile(file);
                              setPasswordError(null);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-amber-500 text-neutral-950 font-bold text-xs flex items-center gap-1.5 shadow-sm hover:bg-amber-400"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>{lang === 'en' ? 'Enter Password' : 'បញ្ចូលលេខសម្ងាត់'}</span>
                          </button>
                        )}

                        {isCompleted && file.hasOutput && (
                          <button
                            onClick={() => handleDownloadSingle(file.fileId)}
                            className="px-3.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 font-bold text-xs flex items-center gap-1.5 transition-all"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>DOCX</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar */}
                    {file.state === 'running' && (
                      <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mt-3">
                        <div
                          className="bg-amber-400 h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(5, file.progress)}%` }}
                        />
                      </div>
                    )}

                    {/* Warnings (if any) */}
                    {file.warnings && file.warnings.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-white/5 space-y-1">
                        {file.warnings.map((w, wIdx) => (
                          <p key={wIdx} className="text-[11px] text-amber-300/80 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            <span>{w.message}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Password Modal */}
      {passwordModalFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="glass-panel p-6 rounded-2xl border border-white/10 max-w-md w-full space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <Lock className="w-4 h-4" />
                <span>{lang === 'en' ? 'Password Protected Document' : 'ឯកសារត្រូវបានការពារដោយលេខសម្ងាត់'}</span>
              </div>
              <button
                onClick={() => setPasswordModalFile(null)}
                className="text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-neutral-300">
              {lang === 'en'
                ? `The file "${passwordModalFile.originalName}" is encrypted. Enter the document password to decrypt and convert.`
                : `ឯកសារ "${passwordModalFile.originalName}" ត្រូវបានការពារ។ សូមបញ្ចូលលេខសម្ងាត់ដើម្បីបម្លែង។`}
            </p>

            {passwordError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
                {passwordError}
              </div>
            )}

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <input
                type="password"
                autoFocus
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder={lang === 'en' ? 'Enter PDF password...' : 'បញ្ចូលលេខសម្ងាត់ PDF...'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-900 border border-white/15 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400"
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPasswordModalFile(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-400 hover:text-white"
                >
                  {lang === 'en' ? 'Cancel' : 'បោះបង់'}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPassword || !passwordInput.trim()}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs flex items-center gap-1.5 transition-all"
                >
                  {isSubmittingPassword && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{lang === 'en' ? 'Unlock & Convert' : 'ដោះសោ និងបម្លែង'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Prominent Disclaimer Footer */}
      <div className="text-center pt-4 border-t border-white/5 space-y-1">
        <p className="text-xs text-neutral-400">
          {lang === 'en'
            ? 'Complex layouts may not convert perfectly.'
            : 'ចំណាំ៖ ប្លង់ស្មុគស្មាញអាចនឹងមិនអាចបម្លែងបានល្អឥតខ្ចោះនោះទេ។'}
        </p>
        <p className="text-[11px] text-neutral-600">
          {lang === 'en'
            ? 'Processed files are securely isolated and automatically purged within 30 minutes.'
            : 'ឯកសារទាំងអស់ត្រូវបានរក្សាទុកដោយសុវត្ថិភាព និងសម្អាតដោយស្វ័យប្រវត្តិក្នុយរយះពេល ៣០ នាទី។'}
        </p>
      </div>
    </div>
  );
};
