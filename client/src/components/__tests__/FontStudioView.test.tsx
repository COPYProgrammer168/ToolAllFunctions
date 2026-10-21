// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FontStudioView } from '../FontStudioView';
import { FONT_STYLES } from '../../services/fontStyleCatalog';

/* PNG export is exercised separately (needs a real canvas); mock it here. */
vi.mock('../../services/textPngExporter', () => ({
  renderTextToPng: vi.fn().mockResolvedValue({ blob: new Blob(), width: 64, height: 32 }),
  downloadPng: vi.fn(),
}));

import { renderTextToPng, downloadPng } from '../../services/textPngExporter';

/**
 * userEvent.setup() installs a working navigator.clipboard stub, so tests
 * assert against the real platform clipboard surface rather than a mock.
 */
async function readClipboard(): Promise<string> {
  return navigator.clipboard.readText();
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

async function typeText(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = screen.getByLabelText('Your Text');
  await user.clear(input);
  await user.type(input, text);
  // generation is debounced (150ms) — wait for the results grid
  await screen.findByLabelText('Generated styles');
}

describe('FontStudioView', () => {
  it('shows the empty state before any text is entered', () => {
    render(<FontStudioView />);
    expect(screen.getByText('Enter text to forge styles')).toBeTruthy();
    expect(screen.queryByLabelText('Generated styles')).toBeNull();
  });

  it('generates real styles when text is entered', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    const grid = screen.getByLabelText('Generated styles');
    expect(grid).toBeTruthy();
    expect(screen.getByText('Quantum Bold')).toBeTruthy();
    expect(screen.getByText('𝐇𝐢')).toBeTruthy(); // mathematical bold output is real
    expect(screen.getByText('Blackletter')).toBeTruthy();
  });

  it('updates the character count as text is entered', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hello');
    expect(screen.getByText('5 / 5000')).toBeTruthy();
  });

  it('copies an individual variation with confirmation', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    const card = screen.getByText('Quantum Bold').closest('article')!;
    await user.click(within(card).getByRole('button', { name: 'Copy' }));

    // the clipboard receives the real Unicode characters
    expect(await readClipboard()).toBe('𝐇𝐢');
    expect(screen.getByRole('status').textContent).toContain(
      'Copied styled text. Paste it into your Discord nickname.'
    );
  });

  it('copies all visible Unicode styles in a predictable format', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    await user.click(screen.getByRole('button', { name: /Copy All/ }));
    const payload = await readClipboard();
    expect(payload.split('\n').every((line) => /^.+: .+$/.test(line))).toBe(true);
    expect(payload).toContain('Quantum Bold: 𝐇𝐢');
    expect(screen.getByRole('status').textContent).toMatch(/Copied \d+ styled texts/);
  });

  it('includes font cards in Copy All — every card copies styled Unicode', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');
    await user.click(screen.getByRole('button', { name: /Copy All/ }));
    const payload = await readClipboard();
    expect(payload).toContain('Orbit Display: 𝗛𝗶'); // sans-bold Unicode, not plain text
    expect(payload).toContain('Fraktur Display:');
  });

  it('warns instead of silently failing when the clipboard is blocked', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    const card = screen.getByText('Quantum Bold').closest('article')!;
    await user.click(within(card).getByRole('button', { name: 'Copy' }));
    expect(screen.getByRole('status').textContent).toContain('Clipboard blocked');
  });

  it('filters by category', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    await user.click(screen.getByRole('tab', { name: 'Gothic & Blackletter' }));
    expect(screen.getByText('Heavy Blackletter')).toBeTruthy();
    expect(screen.queryByText('Quantum Bold')).toBeNull();
  });

  it('searches styles by name', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    await user.type(screen.getByLabelText('Search styles'), 'monospace');
    expect(screen.getByText('Data Mono')).toBeTruthy();
    expect(screen.queryByText('Quantum Bold')).toBeNull();
  });

  it('shows a no-match state for impossible searches', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');
    await user.type(screen.getByLabelText('Search styles'), 'zzzz-nothing');
    expect(await screen.findByText('No styles match your filters')).toBeTruthy();
  });

  it('clears the text and returns to the empty state', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hello world');
    expect(screen.getByLabelText('Generated styles')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('Enter text to forge styles')).toBeTruthy();
    expect((screen.getByLabelText('Your Text') as HTMLTextAreaElement).value).toBe('');
  });

  it('pastes from the clipboard only on user action', async () => {
    const user = userEvent.setup();
    await navigator.clipboard.writeText('Pasted from test');
    render(<FontStudioView />);

    // clipboard untouched until the user presses Paste
    expect((screen.getByLabelText('Your Text') as HTMLTextAreaElement).value).toBe('');

    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect((screen.getByLabelText('Your Text') as HTMLTextAreaElement).value).toBe('Pasted from test');
    expect(screen.getByRole('status').textContent).toContain('Pasted from clipboard');
  });

  it('handles an empty clipboard gracefully on paste', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(screen.getByRole('status').textContent).toContain('Clipboard is empty');
  });

  it('favorites a style and persists it locally', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    const card = screen.getByText('Quantum Bold').closest('article')!;
    const favButton = within(card).getByRole('button', { name: /favorites/ });
    await user.click(favButton);

    expect(within(card).getByRole('button', { name: /Remove from favorites/ })).toBeTruthy();
    expect(window.localStorage.getItem('font-studio:favorites')).toContain('sci-bold');

    // Favorites-only filter keeps exactly the starred style
    await user.click(screen.getByRole('button', { name: /Favorites/ }));
    const grid = screen.getByLabelText('Generated styles');
    expect(within(grid).getByText('Quantum Bold')).toBeTruthy();
    expect(within(grid).queryByText('Blackletter')).toBeNull();
  });

  it('resets controls to defaults', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');
    await user.click(screen.getByRole('tab', { name: 'Gaming & Esports' }));
    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));

    expect(screen.getByRole('tab', { name: 'All Styles' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('Your Text') as HTMLTextAreaElement).value).toBe('');
  });

  it('applies the capitalization control before transforming', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'abc');
    expect(screen.getByText('𝐚𝐛𝐜')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'AA' }));
    expect(screen.getByText('𝐀𝐁𝐂')).toBeTruthy();
  });

  it('applies the letter spacing control', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'abc');
    expect(screen.getByText('𝐚𝐛𝐜')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Letter spacing/), { target: { value: '1' } });
    expect(screen.getByText('𝐚 𝐛 𝐜')).toBeTruthy();
  });

  it('offers image copy and PNG export for font previews only', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    await user.type(screen.getByLabelText('Search styles'), 'Orbit Display');
    const fontCard = screen.getByText('Orbit Display').closest('article')!;

    expect(within(fontCard).getByRole('button', { name: 'Copy Orbit Display as image' })).toBeTruthy();
    expect(within(fontCard).getByRole('button', { name: /transparent PNG/ })).toBeTruthy();

    // font cards copy real Unicode too (sans-bold here), never plain text
    await user.click(within(fontCard).getByRole('button', { name: 'Copy' }));
    expect(await readClipboard()).toBe('𝗛𝗶');
    expect(screen.getByRole('status').textContent).toContain('Discord nickname');

    await user.clear(screen.getByLabelText('Search styles'));
    await user.type(screen.getByLabelText('Search styles'), 'Quantum Bold');
    const unicodeCard = screen.getByText('Quantum Bold').closest('article')!;
    expect(within(unicodeCard).queryByRole('button', { name: /as image/ })).toBeNull();
    expect(within(unicodeCard).queryByRole('button', { name: /transparent PNG/ })).toBeNull();
  });

  it('exports a transparent PNG for font previews', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    await user.type(screen.getByLabelText('Search styles'), 'Orbit Display');
    await user.click(screen.getByRole('button', { name: 'Download Orbit Display as transparent PNG' }));
    expect(renderTextToPng).toHaveBeenCalledTimes(1);
    expect(downloadPng).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('PNG exported');
  });

  it('copies a font preview as an image, downloading when images cannot be clipboard-copied', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    await user.type(screen.getByLabelText('Search styles'), 'Orbit Display');
    await user.click(screen.getByRole('button', { name: 'Copy Orbit Display as image' }));
    expect(renderTextToPng).toHaveBeenCalledTimes(1);
    // jsdom has no ClipboardItem — the fallback downloads the PNG
    // so the styled text is never lost.
    expect(downloadPng).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('downloaded');
  });

  it('preserves mixed scripts and emoji in every rendered result', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'A ខ្ញុំ 🎉');

    const grid = screen.getByLabelText('Generated styles');
    expect(within(grid).getByText('𝐀 ខ្ញុំ 🎉')).toBeTruthy();
    expect(screen.getByText(/Mixed scripts/i)).toBeTruthy();
  });

  it('applies decoration frames to generated output', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    await user.selectOptions(screen.getByLabelText('Decoration frame'), 'fancy');
    expect(screen.getByText('【𝐇𝐢】')).toBeTruthy();
  });

  it('records recent styles (ids only — never the typed text) in localStorage', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    const card = screen.getByText('Quantum Bold').closest('article')!;
    await user.click(within(card).getByRole('button', { name: 'Copy' }));

    const stored = window.localStorage.getItem('font-studio:recents')!;
    expect(stored).toContain('sci-bold');
    expect(stored).not.toContain('Hi');
    expect(screen.getByText('Recent Styles')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(window.localStorage.getItem('font-studio:recents')).toBeNull();
  });

  it('pages results with a Show more control', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    // Only the first page is rendered initially.
    const total = FONT_STYLES.length;
    const grid = screen.getByLabelText('Generated styles');
    expect(grid.querySelectorAll('article').length).toBe(Math.min(24, total));

    await user.click(screen.getByRole('button', { name: /Show more styles/ }));
    expect(grid.querySelectorAll('article').length).toBe(Math.min(48, total));
    expect(screen.getByRole('button', { name: /Show more styles/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Show more styles/ }));
    expect(grid.querySelectorAll('article').length).toBe(Math.min(72, total));
    if (total <= 72) {
      expect(screen.queryByRole('button', { name: /Show more styles/ })).toBeNull();
    } else {
      expect(screen.getByRole('button', { name: /Show more styles/ })).toBeTruthy();
    }
  });

  it('offers the bundled sci-fi and gothic font previews', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    await user.click(screen.getByRole('tab', { name: 'Sci-Fi & Futuristic' }));
    const card = screen.getByText('Megatrox').closest('article')!;
    expect(within(card).getByText('Unicode + font image')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Download Megatrox as transparent PNG' })).toBeTruthy();
    // the preview shows the styled Unicode text in a plain system font
    const preview = within(card).getByText('𝗛𝗶'); // Megatrox → sans bold
    expect(preview.getAttribute('style')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Gothic & Blackletter' }));
    expect(screen.getByText('Xylver Blackletter')).toBeTruthy();
    expect(screen.getByText('The King')).toBeTruthy();
  });

  it('shows a nickname length counter and warns above the Discord limit', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    // styled text is measured, not the input: 'Hi' → 2 styled characters
    const card = screen.getByText('Quantum Bold').closest('article')!;
    expect(within(card).getByText('2 / 32 nickname chars')).toBeTruthy();
    expect(within(card).queryByText(/nickname limit/)).toBeNull();

    await typeText(user, 'A'.repeat(33));
    const overCard = screen.getByText('Quantum Bold').closest('article')!;
    // The live preview is debounced, so wait for the card to catch up.
    expect(await within(overCard).findByText('33 / 32 nickname chars')).toBeTruthy();
    expect(within(overCard).getByText(/Over Discord's 32-character nickname limit/)).toBeTruthy();
  });

  it('overrides the Unicode style per card from the dropdown', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    const card = screen.getByText('Quantum Bold').closest('article')!;
    const dropdown = within(card).getByLabelText('Unicode style') as HTMLSelectElement;
    expect(dropdown.value).toBe('bold-serif');

    await user.selectOptions(dropdown, 'monospace');
    // preview and copy both use the overridden style
    expect(within(card).getByText('𝙷𝚒')).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Copy' }));
    expect(await readClipboard()).toBe('𝙷𝚒');
  });

  it('cards without a plain alphabet equivalent keep their own transform', async () => {
    const user = userEvent.setup();
    render(<FontStudioView />);
    await typeText(user, 'Hi');

    // search narrows the grid to one card that is not on the first page
    await user.type(screen.getByLabelText('Search styles'), 'Quiet Frame');
    const card = screen.getByText('Quiet Frame').closest('article')!;
    const dropdown = within(card).getByLabelText('Unicode style') as HTMLSelectElement;
    expect(dropdown.value).toBe('');
    expect(within(card).getByText(/— Hi —/)).toBeTruthy();
  });
});
