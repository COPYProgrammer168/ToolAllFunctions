// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PdfToWordView } from '../PdfToWordView';

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PdfToWordView Component', () => {
  it('renders the header, dropzone, and disclaimer', () => {
    render(<PdfToWordView />);
    expect(screen.getByText('PDF to Word')).toBeTruthy();
    expect(
      screen.getByText('Drag and drop PDF files here, or click to browse')
    ).toBeTruthy();
    expect(
      screen.getByText('Complex layouts may not convert perfectly.')
    ).toBeTruthy();
  });

  it('switches between English and Khmer localization cleanly', async () => {
    const user = userEvent.setup();
    render(<PdfToWordView />);

    // Click Khmer button
    const khmerBtn = screen.getByText('ភាសាខ្មែរ');
    await user.click(khmerBtn);

    // Verify Khmer text appears
    expect(screen.getByText('កម្មវិធីបម្លែង PDF ទៅជា Word')).toBeTruthy();
    expect(
      screen.getByText('ចំណាំ៖ ប្លង់ស្មុគស្មាញអាចនឹងមិនអាចបម្លែងបានល្អឥតខ្ចោះនោះទេ។')
    ).toBeTruthy();

    // Click English button back
    const enBtn = screen.getByRole('button', { name: 'English' });
    await user.click(enBtn);

    expect(screen.getByText('PDF to Word')).toBeTruthy();
  });

  it('allows selecting conversion mode and OCR options', async () => {
    const user = userEvent.setup();
    render(<PdfToWordView />);

    // Change mode to Plain Text
    const plainTextBtn = screen.getByText('Plain Text');
    await user.click(plainTextBtn);
    expect(plainTextBtn.closest('button')?.className).toContain('bg-amber-500/20');

    // Change OCR mode to disabled
    const disabledOcrBtn = screen.getByRole('button', { name: /disabled/i });
    await user.click(disabledOcrBtn);
    expect(disabledOcrBtn.className).toContain('bg-amber-500/20');
  });

  it('disables the convert button when no files are selected', () => {
    render(<PdfToWordView />);
    const submitBtn = screen.getByRole('button', { name: /Convert.*DOCX/i });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('handles file selection and displays files in list', () => {
    render(<PdfToWordView />);

    const file = new File(['%PDF-1.4 sample content'], 'quarterly_report.pdf', {
      type: 'application/pdf',
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText('quarterly_report.pdf')).toBeTruthy();
    expect(screen.getByText(/SELECTED FILES/i)).toBeTruthy();

    const submitBtn = screen.getByRole('button', { name: /Convert 1 File to DOCX/i });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders active job status and downloads after submitting upload', async () => {
    const user = userEvent.setup();

    // Mock fetch
    const mockPostResponse = {
      jobId: 'job_test_123',
      downloadToken: 'token_abc',
      state: 'running',
      files: [
        {
          fileId: 'file_1',
          originalName: 'test.pdf',
          state: 'running',
          progress: 50,
          stage: 'Processing page 1 of 2...',
          fileSizeBytes: 2048,
        },
      ],
    };

    const mockGetResponse = {
      jobId: 'job_test_123',
      downloadToken: 'token_abc',
      state: 'done',
      files: [
        {
          fileId: 'file_1',
          originalName: 'test.pdf',
          outputName: 'test.docx',
          state: 'done',
          progress: 100,
          stage: 'Completed',
          pageCount: 2,
          pagesConverted: 2,
          fileSizeBytes: 2048,
          hasOutput: true,
        },
      ],
      downloadActions: {
        canDownloadAll: true,
        completedFilesCount: 1,
        totalFilesCount: 1,
      },
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/tools/pdf-to-word/jobs') && init?.method === 'POST') {
        return new Response(JSON.stringify(mockPostResponse), { status: 201 });
      }
      if (urlStr.includes('/api/tools/pdf-to-word/jobs/job_test_123')) {
        return new Response(JSON.stringify(mockGetResponse), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    render(<PdfToWordView />);

    const file = new File(['%PDF-1.4 sample content'], 'test.pdf', {
      type: 'application/pdf',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    const submitBtn = screen.getByRole('button', { name: /Convert 1 File to DOCX/i });
    await user.click(submitBtn);

    // Wait for polling to update to done
    await waitFor(() => {
      expect(screen.getByText('Batch Conversion Status')).toBeTruthy();
      expect(screen.getByText('Completed')).toBeTruthy();
      expect(screen.getByText('DOCX')).toBeTruthy();
    });

    fetchSpy.mockRestore();
  });
});
