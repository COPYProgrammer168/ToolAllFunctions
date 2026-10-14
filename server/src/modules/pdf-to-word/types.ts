export type ConversionMode = 'layout' | 'plain-text';
export type OcrMode = 'auto' | 'enabled' | 'disabled';

export interface PdfToWordOptions {
  pageRange?: string;
  mode: ConversionMode;
  ocrMode: OcrMode;
  ocrLanguages: string[];
  password?: string;
}

export type PageClassification = 'text' | 'scanned' | 'mixed' | 'uncertain';

export interface PageInspectionDetails {
  pageNumber: number;
  classification: PageClassification;
  textLength: number;
  hasImages: boolean;
  imageCount: number;
}

export interface PdfInspection {
  pageCount: number;
  isPasswordProtected: boolean;
  isEncrypted: boolean;
  hasExtractableText: boolean;
  scannedPages: number[];
  pageClassifications: PageInspectionDetails[];
}

export interface ConversionWarning {
  code: string;
  message: string;
}

export interface ConversionResult {
  outputPath: string;
  outputName: string;
  warnings: ConversionWarning[];
  pagesConverted: number;
  ocrPages: number[];
  modeUsed: ConversionMode;
}

export type JobState =
  | 'queued'
  | 'inspecting'
  | 'running'
  | 'needs_password'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface PdfFileJob {
  fileId: string;
  originalName: string;
  safeName: string;
  filePath: string;
  fileSizeBytes: number;
  state: JobState;
  pageCount?: number;
  selectedPages?: number[];
  inspection?: PdfInspection;
  progress: number; // 0 - 100
  stage: string;
  warnings: ConversionWarning[];
  error?: string;
  outputPath?: string;
  outputName?: string;
  pagesConverted?: number;
  ocrPages?: number[];
  needsPassword?: boolean;
}

export interface PdfJob {
  jobId: string;
  clientIp: string;
  createdAt: number;
  updatedAt: number;
  state: JobState;
  files: PdfFileJob[];
  options: PdfToWordOptions;
  downloadToken: string;
  cancelled: boolean;
}
