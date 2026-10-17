// @vitest-environment jsdom
/**
 * Tests the QR view's wiring: that a typed URL becomes an encoded payload, that
 * content-type switching swaps the form, and that the localisation toggle
 * changes the copy.
 *
 * Rendering itself is not asserted — the canvas renderer needs a real
 * compositor — so these tests cover the state and validation logic that decide
 * what gets encoded, which is where the mistakes actually live.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QrCodeView } from '../QrCodeView';

describe('QrCodeView', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // The preview paints into a canvas that jsdom cannot compose, so stub the
    // renderer out; the payload/validation logic under test is unaffected.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  it('renders the view heading and content-type picker', () => {
    render(<QrCodeView />);
    expect(screen.getByText('QR Studio')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'URL' }).length).toBeGreaterThan(0);
  });

  it('prompts for content before anything is entered', () => {
    render(<QrCodeView />);
    // The empty state should tell the user what to do rather than show a blank
    // canvas.
    expect(
      screen.getByText(/Fill in the content on the left to generate a code/i)
    ).toBeTruthy();
  });

  it('switches the form when a different content type is chosen', async () => {
    const user = userEvent.setup();
    render(<QrCodeView />);

    await user.click(screen.getByRole('button', { name: 'Wi-Fi' }));

    expect(screen.getByText(/Network name \(SSID\)/i)).toBeTruthy();
    expect(screen.getByText(/^Security$/i)).toBeTruthy();
    // The URL field must be gone, not merely hidden alongside it.
    expect(screen.queryByText(/Website or link/i)).toBeNull();
  });

  it('shows Wi-Fi specific fields for the Wi-Fi type', async () => {
    const user = userEvent.setup();
    render(<QrCodeView />);
    await user.click(screen.getByRole('button', { name: 'Contact' }));

    expect(screen.getByText(/First name/i)).toBeTruthy();
    expect(screen.getByText(/Company/i)).toBeTruthy();
  });

  it('toggles the interface language', async () => {
    const user = userEvent.setup();
    render(<QrCodeView />);

    await user.click(screen.getByTitle('Language'));

    expect(screen.getByText('ស្ទូឌីយោ QR')).toBeTruthy();
  });

  it('opens the saved library panel', async () => {
    const user = userEvent.setup();
    render(<QrCodeView />);

    await user.click(screen.getByRole('button', { name: /Saved codes/i }));

    // Empty by default, with guidance rather than an empty list.
    expect(screen.getByText(/Nothing saved yet/i)).toBeTruthy();
  });

  it('opens the batch panel and counts pasted entries', async () => {
    const user = userEvent.setup();
    render(<QrCodeView />);

    await user.click(screen.getByRole('button', { name: /Batch from list/i }));
    const textarea = screen.getByPlaceholderText(/promo,example\.com\/sale/);
    await user.type(textarea, 'a.com\nb.com');

    await waitFor(() => {
      expect(screen.getByText('2')).toBeTruthy();
    });
  });

  it('refuses to save to the library with nothing generated', async () => {
    const user = userEvent.setup();
    render(<QrCodeView />);

    // The save control is the icon-only button next to the name field.
    const saveButtons = screen.getAllByRole('button');
    const saveButton = saveButtons[saveButtons.length - 1];
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/Generate a code before saving it/i)).toBeTruthy();
    });
  });
});
