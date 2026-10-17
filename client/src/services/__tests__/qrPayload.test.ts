// @vitest-environment jsdom
/**
 * Tests the encoders that produce the text inside a QR code.
 *
 * These formats fail silently on a phone — a mis-escaped Wi-Fi password or a
 * malformed vCard produces a code that scans and then does nothing useful — so
 * the exact wire format is asserted here rather than checked by eye.
 */

import { describe, expect, it } from 'vitest';
import {
  buildEmailPayload,
  buildEventPayload,
  buildGeoPayload,
  buildPayload,
  buildSmsPayload,
  buildVCardPayload,
  buildWifiPayload,
  normalizeUrl,
} from '../qrPayload';

describe('normalizeUrl', () => {
  it('adds https to a bare domain', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
  });

  it('leaves an existing scheme alone', () => {
    expect(normalizeUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
    expect(normalizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
  });

  it('does not mangle free text containing spaces', () => {
    expect(normalizeUrl('hello world')).toBe('hello world');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com');
  });
});

describe('buildWifiPayload', () => {
  it('builds the WIFI scheme in the documented order', () => {
    expect(
      buildWifiPayload({ ssid: 'Office', password: 'pw', encryption: 'WPA', hidden: false })
    ).toEqual({ ok: true, data: 'WIFI:T:WPA;S:Office;P:pw;;' });
  });

  it('omits the password for an open network', () => {
    expect(
      buildWifiPayload({ ssid: 'Cafe', password: '', encryption: 'nopass', hidden: false })
    ).toEqual({ ok: true, data: 'WIFI:T:nopass;S:Cafe;;' });
  });

  it('marks a hidden network', () => {
    const result = buildWifiPayload({
      ssid: 'Hidden',
      password: 'pw',
      encryption: 'WPA',
      hidden: true,
    });
    expect(result).toEqual({ ok: true, data: 'WIFI:T:WPA;S:Hidden;P:pw;H:true;;' });
  });

  it('escapes syntax characters in the SSID and password', () => {
    const result = buildWifiPayload({
      ssid: 'My;Net',
      password: 'a:b,c"d\\e',
      encryption: 'WPA',
      hidden: false,
    });
    expect(result.ok).toBe(true);
    // The delimiters must be backslash-escaped or the scanner reads them as
    // field separators and joins the wrong password.
    if (result.ok) {
      expect(result.data).toBe('WIFI:T:WPA;S:My\\;Net;P:a\\:b\\,c\\"d\\\\e;;');
    }
  });

  it('requires an SSID', () => {
    const result = buildWifiPayload({ ssid: '  ', password: 'pw', encryption: 'WPA', hidden: false });
    expect(result.ok).toBe(false);
  });

  it('requires a password unless the network is open', () => {
    expect(
      buildWifiPayload({ ssid: 'Net', password: '', encryption: 'WPA', hidden: false }).ok
    ).toBe(false);
    expect(
      buildWifiPayload({ ssid: 'Net', password: '', encryption: 'nopass', hidden: false }).ok
    ).toBe(true);
  });
});

describe('buildVCardPayload', () => {
  it('emits a vCard 3.0 block with the structured name', () => {
    const result = buildVCardPayload({
      firstName: 'Dara',
      lastName: 'Sok',
      org: 'Acme',
      title: 'Engineer',
      phone: '+85512345',
      email: 'dara@acme.com',
      website: 'https://acme.com',
      address: 'Phnom Penh',
      note: '',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.startsWith('BEGIN:VCARD\r\nVERSION:3.0')).toBe(true);
    expect(result.data.endsWith('END:VCARD')).toBe(true);
    expect(result.data).toContain('N:Sok;Dara;;;');
    expect(result.data).toContain('FN:Dara Sok');
    expect(result.data).toContain('ORG:Acme');
    expect(result.data).toContain('TEL;TYPE=CELL:+85512345');
    expect(result.data).toContain('EMAIL;TYPE=INTERNET:dara@acme.com');
    // An empty note must not appear at all.
    expect(result.data).not.toContain('NOTE:');
  });

  it('escapes commas, semicolons and newlines in values', () => {
    const result = buildVCardPayload({
      firstName: 'A',
      lastName: 'B',
      org: 'Acme, Inc; Ltd',
      title: '',
      phone: '',
      email: '',
      website: '',
      address: '',
      note: 'line one\nline two',
    });

    if (!result.ok) throw new Error('expected a vCard payload');
    expect(result.data).toContain('ORG:Acme\\, Inc\\; Ltd');
    expect(result.data).toContain('NOTE:line one\\nline two');
    // A literal newline inside a property would split it into two lines.
    expect(result.data.split('\r\n').some((line) => line === 'line two')).toBe(false);
  });

  it('uses CRLF line endings, which some scanners require', () => {
    const result = buildVCardPayload({
      firstName: 'A',
      lastName: 'B',
      org: '',
      title: '',
      phone: '',
      email: '',
      website: '',
      address: '',
      note: '',
    });
    if (!result.ok) throw new Error('expected a vCard payload');
    expect(result.data).not.toMatch(/[^\r]\n/);
  });

  it('requires at least one name part', () => {
    const result = buildVCardPayload({
      firstName: '',
      lastName: '',
      org: 'Acme',
      title: '',
      phone: '',
      email: '',
      website: '',
      address: '',
      note: '',
    });
    expect(result.ok).toBe(false);
  });
});

describe('buildEmailPayload', () => {
  it('percent-encodes the subject and body', () => {
    const result = buildEmailPayload({ to: 'a@b.com', subject: 'Hi there', body: 'a & b' });
    expect(result).toEqual({
      ok: true,
      data: 'mailto:a@b.com?subject=Hi+there&body=a+%26+b',
    });
  });

  it('omits the query when there is no subject or body', () => {
    expect(buildEmailPayload({ to: 'a@b.com', subject: '', body: '' })).toEqual({
      ok: true,
      data: 'mailto:a@b.com',
    });
  });

  it('requires a recipient', () => {
    expect(buildEmailPayload({ to: '', subject: 'x', body: '' }).ok).toBe(false);
  });
});

describe('buildSmsPayload', () => {
  it('includes the message when present', () => {
    expect(buildSmsPayload({ phone: '+855', message: 'Hello' })).toEqual({
      ok: true,
      data: 'SMSTO:+855:Hello',
    });
  });

  it('omits the trailing colon with no message', () => {
    expect(buildSmsPayload({ phone: '+855', message: '' })).toEqual({
      ok: true,
      data: 'SMSTO:+855',
    });
  });

  it('requires a number', () => {
    expect(buildSmsPayload({ phone: '  ', message: 'x' }).ok).toBe(false);
  });
});

describe('buildEventPayload', () => {
  it('converts local datetimes to UTC ICS timestamps', () => {
    // Interpreted in the test runner's local zone, so assert on shape rather
    // than a fixed instant to keep the test timezone-independent.
    const result = buildEventPayload({
      title: 'Launch',
      location: 'Phnom Penh',
      start: '2026-03-01T10:00',
      end: '2026-03-01T11:00',
      description: '',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.startsWith('BEGIN:VEVENT')).toBe(true);
    expect(result.data).toContain('SUMMARY:Launch');
    expect(result.data).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(result.data).toMatch(/DTEND:\d{8}T\d{6}Z/);
    expect(result.data).toContain('LOCATION:Phnom Penh');
    expect(result.data.endsWith('END:VEVENT')).toBe(true);
  });

  it('rejects an end time before the start time', () => {
    const result = buildEventPayload({
      title: 'Launch',
      location: '',
      start: '2026-03-01T11:00',
      end: '2026-03-01T10:00',
      description: '',
    });
    expect(result.ok).toBe(false);
  });

  it('requires a title and a start time', () => {
    expect(
      buildEventPayload({ title: '', location: '', start: '2026-03-01T10:00', end: '', description: '' }).ok
    ).toBe(false);
    expect(
      buildEventPayload({ title: 'X', location: '', start: '', end: '', description: '' }).ok
    ).toBe(false);
  });
});

describe('buildGeoPayload', () => {
  it('formats coordinates', () => {
    expect(buildGeoPayload({ lat: '11.5564', lng: '104.9282' })).toEqual({
      ok: true,
      data: 'geo:11.5564,104.9282',
    });
  });

  it('rejects out-of-range and non-numeric values', () => {
    expect(buildGeoPayload({ lat: '91', lng: '0' }).ok).toBe(false);
    expect(buildGeoPayload({ lat: '0', lng: '181' }).ok).toBe(false);
    expect(buildGeoPayload({ lat: 'abc', lng: '0' }).ok).toBe(false);
    expect(buildGeoPayload({ lat: '', lng: '' }).ok).toBe(false);
  });
});

describe('buildPayload routing', () => {
  it('routes each content type to its encoder', () => {
    expect(buildPayload({ type: 'url', value: 'a.com' })).toEqual({ ok: true, data: 'https://a.com' });
    expect(buildPayload({ type: 'text', value: ' hi ' })).toEqual({ ok: true, data: 'hi' });
    expect(buildPayload({ type: 'phone', value: ' 123 ' })).toEqual({ ok: true, data: 'tel:123' });
  });

  it('reports an error rather than throwing for empty input', () => {
    // The live preview calls this on every keystroke, so empty must be a
    // normal result and not an exception.
    expect(buildPayload({ type: 'url', value: '' }).ok).toBe(false);
    expect(buildPayload({ type: 'text', value: '   ' }).ok).toBe(false);
    expect(buildPayload({ type: 'file', value: '' }).ok).toBe(false);
  });
});
