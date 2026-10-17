/**
 * Field state for the QR content forms, plus the labels for each content type.
 *
 * Kept out of the component file so `QrContentFields.tsx` exports only
 * components — a file mixing components and constants breaks React Fast
 * Refresh, and oxlint flags it.
 */

import type { QrContentType, QrPayloadInput } from '../../services/qrPayload';
import type { QrStrings } from './qrStrings';

/** Field state for every type except `file`, which stores a hosted link. */
export interface QrFieldsState {
  url: string;
  text: string;
  fileUrl: string;
  phone: string;
  wifiSsid: string;
  wifiPassword: string;
  wifiEncryption: string;
  wifiHidden: boolean;
  vcardFirst: string;
  vcardLast: string;
  vcardOrg: string;
  vcardTitle: string;
  vcardPhone: string;
  vcardEmail: string;
  vcardWebsite: string;
  vcardAddress: string;
  vcardNote: string;
  emailTo: string;
  emailSubject: string;
  emailBody: string;
  smsPhone: string;
  smsMessage: string;
  eventTitle: string;
  eventLocation: string;
  eventStart: string;
  eventEnd: string;
  eventDescription: string;
  geoLat: string;
  geoLng: string;
}

export const EMPTY_FIELDS: QrFieldsState = {
  url: '',
  text: '',
  fileUrl: '',
  phone: '',
  wifiSsid: '',
  wifiPassword: '',
  wifiEncryption: 'WPA',
  wifiHidden: false,
  vcardFirst: '',
  vcardLast: '',
  vcardOrg: '',
  vcardTitle: '',
  vcardPhone: '',
  vcardEmail: '',
  vcardWebsite: '',
  vcardAddress: '',
  vcardNote: '',
  emailTo: '',
  emailSubject: '',
  emailBody: '',
  smsPhone: '',
  smsMessage: '',
  eventTitle: '',
  eventLocation: '',
  eventStart: '',
  eventEnd: '',
  eventDescription: '',
  geoLat: '',
  geoLng: '',
};

/** Order the content-type picker renders them in. */
export const CONTENT_TYPE_ORDER: QrContentType[] = [
  'url',
  'text',
  'file',
  'wifi',
  'vcard',
  'email',
  'sms',
  'phone',
  'event',
  'geo',
];

export function contentTypeLabels(s: QrStrings): Record<QrContentType, string> {
  return {
    url: s.typeUrl,
    text: s.typeText,
    file: s.typeFile,
    wifi: s.typeWifi,
    vcard: s.typeVcard,
    email: s.typeEmail,
    sms: s.typeSms,
    phone: s.typePhone,
    event: s.typeEvent,
    geo: s.typeGeo,
  };
}

/** True when the user has not entered anything yet for this content type. */
export function isContentEmpty(type: QrContentType, fields: QrFieldsState): boolean {
  switch (type) {
    case 'url':
      return !fields.url.trim();
    case 'text':
      return !fields.text.trim();
    case 'file':
      return !fields.fileUrl.trim();
    case 'phone':
      return !fields.phone.trim();
    case 'wifi':
      return !fields.wifiSsid.trim();
    case 'vcard':
      return !fields.vcardFirst.trim() && !fields.vcardLast.trim();
    case 'email':
      return !fields.emailTo.trim();
    case 'sms':
      return !fields.smsPhone.trim();
    case 'event':
      return !fields.eventTitle.trim() && !fields.eventStart;
    case 'geo':
      return !fields.geoLat.trim() && !fields.geoLng.trim();
  }
}

/**
 * Maps the flat field state onto the payload builder's discriminated input.
 */
export function payloadInputFor(type: QrContentType, fields: QrFieldsState): QrPayloadInput {
  switch (type) {
    case 'url':
      return { type: 'url', value: fields.url };
    case 'text':
      return { type: 'text', value: fields.text };
    case 'file':
      return { type: 'file', value: fields.fileUrl };
    case 'phone':
      return { type: 'phone', value: fields.phone };
    case 'wifi':
      return {
        type: 'wifi',
        fields: {
          ssid: fields.wifiSsid,
          password: fields.wifiPassword,
          encryption: (fields.wifiEncryption as 'WPA' | 'WEP' | 'nopass') ?? 'WPA',
          hidden: fields.wifiHidden,
        },
      };
    case 'vcard':
      return {
        type: 'vcard',
        fields: {
          firstName: fields.vcardFirst,
          lastName: fields.vcardLast,
          org: fields.vcardOrg,
          title: fields.vcardTitle,
          phone: fields.vcardPhone,
          email: fields.vcardEmail,
          website: fields.vcardWebsite,
          address: fields.vcardAddress,
          note: fields.vcardNote,
        },
      };
    case 'email':
      return {
        type: 'email',
        fields: { to: fields.emailTo, subject: fields.emailSubject, body: fields.emailBody },
      };
    case 'sms':
      return { type: 'sms', fields: { phone: fields.smsPhone, message: fields.smsMessage } };
    case 'event':
      return {
        type: 'event',
        fields: {
          title: fields.eventTitle,
          location: fields.eventLocation,
          start: fields.eventStart,
          end: fields.eventEnd,
          description: fields.eventDescription,
        },
      };
    case 'geo':
      return { type: 'geo', fields: { lat: fields.geoLat, lng: fields.geoLng } };
  }
}
