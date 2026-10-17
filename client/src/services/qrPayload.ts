/**
 * Builds the string that actually gets encoded into a QR code.
 *
 * Each content type has its own wire format — Wi-Fi uses the `WIFI:` scheme,
 * contacts use vCard, and so on. Every builder returns a result object instead
 * of throwing, so the view can show an inline message while the user is still
 * half-way through filling a form (the normal state of a live preview).
 *
 * Kept free of DOM and library imports so the formats can be unit tested
 * directly — a malformed vCard or Wi-Fi payload fails silently on a phone,
 * which is not something a UI test would ever catch.
 */

export type QrContentType =
  | 'url'
  | 'text'
  | 'file'
  | 'wifi'
  | 'vcard'
  | 'email'
  | 'sms'
  | 'phone'
  | 'event'
  | 'geo';

export type PayloadResult = { ok: true; data: string } | { ok: false; error: string };

export interface WifiFields {
  ssid: string;
  password: string;
  /** `nopass` renders an open network and ignores the password. */
  encryption: 'WPA' | 'WEP' | 'nopass';
  hidden: boolean;
}

export interface VCardFields {
  firstName: string;
  lastName: string;
  org: string;
  title: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  note: string;
}

export interface EmailFields {
  to: string;
  subject: string;
  body: string;
}

export interface SmsFields {
  phone: string;
  message: string;
}

export interface EventFields {
  title: string;
  location: string;
  /** Local datetime string from `<input type="datetime-local">`. */
  start: string;
  end: string;
  description: string;
}

export interface GeoFields {
  lat: string;
  lng: string;
}

/** Discriminated input accepted by {@link buildPayload}. */
export type QrPayloadInput =
  | { type: 'url'; value: string }
  | { type: 'text'; value: string }
  | { type: 'file'; value: string }
  | { type: 'wifi'; fields: WifiFields }
  | { type: 'vcard'; fields: VCardFields }
  | { type: 'email'; fields: EmailFields }
  | { type: 'sms'; fields: SmsFields }
  | { type: 'phone'; value: string }
  | { type: 'event'; fields: EventFields }
  | { type: 'geo'; fields: GeoFields };

const ok = (data: string): PayloadResult => ({ ok: true, data });
const fail = (error: string): PayloadResult => ({ ok: false, error });

/**
 * Escapes the characters `WIFI:` treats as syntax. The backslash must be
 * replaced first, otherwise the escapes added for the other characters would
 * themselves get escaped a second time.
 */
function escapeWifiValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/([;,:"])/g, '\\$1');
}

/**
 * Escapes a vCard property value. Newlines are encoded rather than emitted so
 * one property never spans two physical lines.
 */
function escapeVCardValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/([;,])/g, '\\$1');
}

/**
 * Folds a vCard line at 75 octets, continuing with a leading space, per
 * RFC 6350. Long URLs in a contact would otherwise exceed what some scanners
 * accept.
 */
function foldVCardLine(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  return parts.join('\r\n');
}

/** Prefixes a bare host with `https://` so typed domains still scan correctly. */
export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  // Only add a scheme when the value looks like a host: has no scheme already
  // and contains no spaces (which would mean it is really free text).
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  if (/\s/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Converts a `datetime-local` value to the UTC form vCard events expect. */
function toIcsTimestamp(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export function buildWifiPayload(fields: WifiFields): PayloadResult {
  const ssid = fields.ssid.trim();
  if (!ssid) return fail('Enter the network name (SSID).');
  if (fields.encryption !== 'nopass' && !fields.password) {
    return fail('Enter the Wi-Fi password, or choose "Open".');
  }

  // Order matters to some older scanners: type, SSID, password, hidden.
  let out = `WIFI:T:${fields.encryption};S:${escapeWifiValue(ssid)};`;
  if (fields.encryption !== 'nopass') {
    out += `P:${escapeWifiValue(fields.password)};`;
  }
  if (fields.hidden) out += 'H:true;';
  return ok(`${out};`);
}

export function buildVCardPayload(fields: VCardFields): PayloadResult {
  const first = fields.firstName.trim();
  const last = fields.lastName.trim();
  if (!first && !last) return fail('Enter at least a first or last name.');

  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`N:${escapeVCardValue(last)};${escapeVCardValue(first)};;;`);
  lines.push(`FN:${escapeVCardValue([first, last].filter(Boolean).join(' '))}`);
  if (fields.org.trim()) lines.push(`ORG:${escapeVCardValue(fields.org.trim())}`);
  if (fields.title.trim()) lines.push(`TITLE:${escapeVCardValue(fields.title.trim())}`);
  if (fields.phone.trim()) lines.push(`TEL;TYPE=CELL:${escapeVCardValue(fields.phone.trim())}`);
  if (fields.email.trim()) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCardValue(fields.email.trim())}`);
  if (fields.website.trim()) lines.push(`URL:${escapeVCardValue(fields.website.trim())}`);
  if (fields.address.trim()) lines.push(`ADR;TYPE=WORK:;;${escapeVCardValue(fields.address.trim())};;;;`);
  if (fields.note.trim()) lines.push(`NOTE:${escapeVCardValue(fields.note.trim())}`);
  lines.push('END:VCARD');

  return ok(lines.map(foldVCardLine).join('\r\n'));
}

export function buildEmailPayload(fields: EmailFields): PayloadResult {
  const to = fields.to.trim();
  if (!to) return fail('Enter a recipient email address.');

  const params = new URLSearchParams();
  if (fields.subject.trim()) params.set('subject', fields.subject.trim());
  if (fields.body.trim()) params.set('body', fields.body.trim());
  const query = params.toString();
  return ok(`mailto:${to}${query ? `?${query}` : ''}`);
}

export function buildSmsPayload(fields: SmsFields): PayloadResult {
  const phone = fields.phone.trim();
  if (!phone) return fail('Enter a phone number.');

  // `SMSTO:` is the widely supported form and carries a message body without
  // the `?body=` query that iOS historically ignored.
  const message = fields.message.trim();
  return ok(message ? `SMSTO:${phone}:${message}` : `SMSTO:${phone}`);
}

export function buildPhonePayload(value: string): PayloadResult {
  const phone = value.trim();
  if (!phone) return fail('Enter a phone number.');
  return ok(`tel:${phone}`);
}

export function buildEventPayload(fields: EventFields): PayloadResult {
  const title = fields.title.trim();
  if (!title) return fail('Enter an event title.');

  const start = toIcsTimestamp(fields.start);
  const end = toIcsTimestamp(fields.end);
  if (!start) return fail('Choose a start date and time.');
  // Compare the original `datetime-local` values: the ICS form is not reliably
  // parseable by `new Date()`.
  if (fields.end && end && new Date(fields.end) < new Date(fields.start)) {
    return fail('The end time is before the start time.');
  }

  const lines = ['BEGIN:VEVENT', `SUMMARY:${escapeVCardValue(title)}`];
  lines.push(`DTSTART:${start}`);
  if (end) lines.push(`DTEND:${end}`);
  if (fields.location.trim()) lines.push(`LOCATION:${escapeVCardValue(fields.location.trim())}`);
  if (fields.description.trim()) lines.push(`DESCRIPTION:${escapeVCardValue(fields.description.trim())}`);
  lines.push('END:VEVENT');

  return ok(lines.map(foldVCardLine).join('\r\n'));
}

export function buildGeoPayload(fields: GeoFields): PayloadResult {
  const latRaw = fields.lat.trim();
  const lngRaw = fields.lng.trim();
  // `Number('')` is 0, which would silently produce a valid-looking `geo:0,0`
  // for an empty form, so the raw strings are checked first.
  if (!latRaw || !lngRaw) return fail('Enter a latitude and longitude.');

  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return fail('Enter a numeric latitude and longitude.');
  }
  if (lat < -90 || lat > 90) return fail('Latitude must be between -90 and 90.');
  if (lng < -180 || lng > 180) return fail('Longitude must be between -180 and 180.');

  return ok(`geo:${lat},${lng}`);
}

/** Routes a discriminated payload input to its builder. */
export function buildPayload(input: QrPayloadInput): PayloadResult {
  switch (input.type) {
    case 'url': {
      const url = normalizeUrl(input.value);
      return url ? ok(url) : fail('Enter a URL to encode.');
    }
    case 'text': {
      const text = input.value.trim();
      return text ? ok(text) : fail('Enter some text to encode.');
    }
    case 'file': {
      const url = input.value.trim();
      return url ? ok(url) : fail('Upload a file to get its link first.');
    }
    case 'wifi':
      return buildWifiPayload(input.fields);
    case 'vcard':
      return buildVCardPayload(input.fields);
    case 'email':
      return buildEmailPayload(input.fields);
    case 'sms':
      return buildSmsPayload(input.fields);
    case 'phone':
      return buildPhonePayload(input.value);
    case 'event':
      return buildEventPayload(input.fields);
    case 'geo':
      return buildGeoPayload(input.fields);
  }
}

/** Human label for each content type, used by the type picker. */
export const QR_CONTENT_LABELS: Record<QrContentType, string> = {
  url: 'URL',
  text: 'Text',
  file: 'File link',
  wifi: 'Wi-Fi',
  vcard: 'Contact',
  email: 'Email',
  sms: 'SMS',
  phone: 'Phone',
  event: 'Event',
  geo: 'Location',
};
