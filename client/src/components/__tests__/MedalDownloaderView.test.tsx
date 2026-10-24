// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MedalDownloaderView } from '../MedalDownloaderView';
import {
  cancelMedalDownload,
  getMedalJob,
  medalDownloadUrl,
  startMedalDownload,
  inspectMedalClip,
} from '../../services/api';

vi.mock('../../services/api', () => {
  class MockMediaApiError extends Error {
    status?: number;
    retryAfter?: number;
    isRateLimited = false;

    constructor(message: string, options: { status?: number; retryAfter?: number } = {}) {
      super(message);
      this.name = 'MediaApiError';
      this.status = options.status;
      this.retryAfter = options.retryAfter;
      this.isRateLimited = options.status === 429;
    }
  }

  return {
    MediaApiError: MockMediaApiError,
    inspectMedalClip: vi.fn(),
    startMedalDownload: vi.fn(),
    getMedalJob: vi.fn(),
    cancelMedalDownload: vi.fn(),
    medalDownloadUrl: (jobId: string, token: string) =>
      `/api/tools/medal-downloader/jobs/${jobId}/download?token=${token}`,
  };
});

const CLIP_ID = 'nMVYBnbtZWJPDsstr';
const CLIP_URL = `https://medal.tv/games/racing-master/clips/${CLIP_ID}?invite=cr-MSxBUG8sOTcwMDM2MTg3`;
const UNAVAILABLE_MESSAGE =
  "This clip cannot be downloaded through this tool. Open it on Medal.tv and use Medal's available download option.";

const availableInspection = {
  clip: {
    clipId: CLIP_ID,
    gameSlug: 'racing-master',
    gameName: 'RACING MASTER',
    title: 'Untitled',
    creator: 'kyukaiz',
    durationSeconds: 60.13,
    uploadedAt: '2026-10-24T06:57:38.145Z',
    canonicalUrl: `https://medal.tv/games/racing-master/clips/${CLIP_ID}`,
  },
  download: {
    available: true,
    state: 'available' as const,
    container: 'mp4' as const,
    contentType: 'video/mp4',
    sizeBytes: 30_638_865,
  },
  authorizationRequired: true as const,
  authorizationNotice: 'Only download clips you own or have permission to download.',
  officialWorkflowUrl:
    'https://support.medal.tv/support/solutions/articles/48000922113-how-to-download-medal-clips',
  officialWorkflowLabel: 'Open Medal download guide',
  inspectedAt: '2026-10-24T07:00:00.000Z',
};

const unavailableInspection = {
  ...availableInspection,
  download: {
    available: false,
    state: 'download_not_available' as const,
    reason: 'no_public_original',
    message: UNAVAILABLE_MESSAGE,
  },
};

const baseJob = {
  jobId: 'job123',
  state: 'downloading' as const,
  stage: 'Downloading original MP4',
  createdAt: '2026-10-24T07:00:00.000Z',
  updatedAt: '2026-10-24T07:00:02.000Z',
  expiresAt: '2026-10-24T07:30:00.000Z',
  clip: availableInspection.clip,
  progress: { percent: 42, downloadedBytes: 12_000_000, totalBytes: 30_638_865 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inspectMedalClip).mockResolvedValue(availableInspection as never);
  vi.mocked(startMedalDownload).mockResolvedValue({
    jobId: 'job123',
    downloadToken: 'secret-token',
    state: 'queued',
    createdAt: '2026-10-24T07:00:00.000Z',
    expiresAt: '2026-10-24T07:30:00.000Z',
  });
  vi.mocked(getMedalJob).mockResolvedValue(baseJob);
  vi.mocked(cancelMedalDownload).mockResolvedValue(true);
});

async function inspectClip(url = CLIP_URL) {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: url } });
  fireEvent.submit(input.closest('form')!);
}

describe('MedalDownloaderView', () => {
  it('renders the heading, URL form, and SEO metadata', () => {
    render(<MedalDownloaderView />);

    expect(screen.getByRole('heading', { name: /Medal.tv Video Downloader/i })).toBeTruthy();
    expect(screen.getByText('Medal.tv clip link')).toBeTruthy();
    expect(
      screen.getByText('Inspect a clip to see its available metadata and download options.')
    ).toBeTruthy();
    expect(document.title).toBe('Medal.tv Video Downloader | AI Video Optimizer');
    const meta = document.querySelector('meta[name="description"]');
    expect(meta?.getAttribute('content')).toContain('Download available Medal.tv gaming clips');
  });

  it('rejects an unsupported URL locally without calling the API', () => {
    render(<MedalDownloaderView />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://medal.tv.evil.example/clips/abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Inspect clip/i }));

    expect(inspectMedalClip).not.toHaveBeenCalled();
    expect(
      screen.getByText('Paste a valid Medal.tv clip link. HTTP and lookalike domains are rejected.')
    ).toBeTruthy();
  });

  it('shows genuinely retrieved metadata and requires authorization before starting', async () => {
    const user = userEvent.setup();
    render(<MedalDownloaderView />);

    await inspectClip();

    expect((await screen.findAllByText('kyukaiz')).length).toBeGreaterThan(0);
    expect(screen.getByText('RACING MASTER')).toBeTruthy();
    expect(screen.getByText('Untitled')).toBeTruthy();
    expect(screen.getByText(CLIP_ID)).toBeTruthy();
    expect(inspectMedalClip).toHaveBeenCalledWith(CLIP_URL);

    const start = screen.getByRole('button', { name: /Download original MP4/i });
    expect((start as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByLabelText('I own this clip or have permission to download it.'));
    expect((start as HTMLButtonElement).disabled).toBe(false);
    await user.click(start);

    await waitFor(() =>
      expect(startMedalDownload).toHaveBeenCalledWith(CLIP_URL)
    );
    expect(await screen.findByText('Download progress')).toBeTruthy();
    expect(await screen.findByText('42%')).toBeTruthy();
  });

  it('shows the exact unavailable message and never offers a download', async () => {
    vi.mocked(inspectMedalClip).mockResolvedValue(unavailableInspection as never);
    render(<MedalDownloaderView />);

    await inspectClip();

    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download original MP4/i })).toBeNull();
    expect(screen.getAllByRole('link', { name: /Open clip on Medal.tv/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Medal download guide/i }).length).toBeGreaterThan(0);
  });

  it('switches to Khmer while keeping the exact unavailable wording', async () => {
    vi.mocked(inspectMedalClip).mockResolvedValue(unavailableInspection as never);
    const user = userEvent.setup();
    render(<MedalDownloaderView />);

    await user.click(screen.getByRole('button', { name: /ខ្មែរ/i }));
    expect(screen.getByRole('heading', { name: /កម្មវិធីទាញយកវីដេអូ Medal.tv/i })).toBeTruthy();

    await inspectClip();
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeTruthy();
  });

  it('shows the byte-for-byte MP4 result and tokenized download link when done', async () => {
    const user = userEvent.setup();
    vi.mocked(getMedalJob).mockResolvedValue({
      ...baseJob,
      state: 'done',
      stage: 'Ready for download',
      progress: { percent: 100, downloadedBytes: 30_638_865, totalBytes: 30_638_865 },
      media: {
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 1244,
        height: 720,
        fps: 60,
        durationSeconds: 60.13,
        sizeBytes: 30_638_865,
      },
      filename: `Untitled-${CLIP_ID}.mp4`,
    });

    render(<MedalDownloaderView />);
    await inspectClip();
    await user.click(
      await screen.findByLabelText('I own this clip or have permission to download it.')
    );
    await user.click(screen.getByRole('button', { name: /Download original MP4/i }));

    expect(await screen.findByText('Your clip is ready.')).toBeTruthy();
    expect(screen.getByText('1244×720')).toBeTruthy();
    expect(screen.getByText('H264')).toBeTruthy();
    expect(screen.getByText('AAC')).toBeTruthy();

    const download = screen.getByRole('link', { name: /Save MP4/i });
    expect(download.getAttribute('href')).toBe(medalDownloadUrl('job123', 'secret-token'));
    expect(download.getAttribute('download')).toBe(`Untitled-${CLIP_ID}.mp4`);
  });
});
