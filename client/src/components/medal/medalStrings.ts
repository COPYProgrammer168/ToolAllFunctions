export type MedalLang = 'en' | 'kh';

export const MEDAL_UNAVAILABLE_MESSAGE =
  "This clip cannot be downloaded through this tool. Open it on Medal.tv and use Medal's available download option.";

const en = {
  title: 'Medal.tv Video Downloader',
  subtitle:
    'Inspect a public Medal.tv gaming clip and download the original MP4 when Medal publicly exposes it.',
  languageButton: 'ខ្មែរ',
  urlLabel: 'Medal.tv clip link',
  urlPlaceholder: 'https://medal.tv/games/game-name/clips/CLIP_ID',
  paste: 'Paste',
  inspect: 'Inspect clip',
  inspecting: 'Inspecting…',
  invalidUrl: 'Paste a valid Medal.tv clip link. HTTP and lookalike domains are rejected.',
  clipDetails: 'Clip details',
  creator: 'Creator',
  game: 'Game',
  duration: 'Duration',
  uploaded: 'Uploaded',
  format: 'Format',
  resolution: 'Resolution',
  size: 'Size',
  clipId: 'Clip ID',
  originalFormat: 'MP4 (original)',
  unknownSize: 'Size unavailable',
  originalQuality: 'Original file',
  originalQualityHint:
    'The public MP4 is saved byte-for-byte. No re-encoding, remuxing, or upscaling.',
  downloadAvailable: 'Original MP4 available',
  downloadUnavailable: 'Download not available',
  unavailableMessage: MEDAL_UNAVAILABLE_MESSAGE,
  unavailableKhmer:
    'ឃ្លីបនេះមិនអាចទាញយកបានតាមរយៈឧបករណ៍នេះទេ។ សូមបើកវានៅ Medal.tv ហើយប្រើជម្រើសទាញយកដែលមាននៅលើ Medal។',
  openOnMedal: 'Open clip on Medal.tv',
  openGuide: 'Medal download guide',
  officialNote:
    'Medal controls availability. If the original file is not public, this tool will not bypass the restriction.',
  authorizationHeading: 'Download permission',
  authorizationLabel: 'I own this clip or have permission to download it.',
  authorizationHint:
    'Only public originals are fetched. Private, premium, DRM-protected, CAPTCHA-protected, and rate-limited content is never bypassed.',
  startDownload: 'Download original MP4',
  starting: 'Starting…',
  authorizationRequired: 'Confirm that you have permission before starting the download.',
  jobHeading: 'Download progress',
  stateQueued: 'Queued',
  stateInspecting: 'Inspecting on Medal.tv',
  stateDownloading: 'Downloading original MP4',
  stateDone: 'Ready for download',
  stateFailed: 'Download failed',
  stateCancelled: 'Cancelled',
  stateUnavailable: 'Download not available',
  ready: 'Your clip is ready.',
  downloadFile: 'Save MP4',
  cancel: 'Cancel',
  retry: 'Inspect again',
  progressUnknown: 'Downloading… size not reported by Medal',
  downloaded: 'downloaded',
  of: 'of',
  rateLimited: 'Medal is rate-limiting this server. Try again in {seconds} seconds.',
  requestFailed: 'Something went wrong. Please try again.',
  jobExpired: 'This download job expired. Inspect the clip again.',
  unauthorized: 'This download belongs to another session.',
  noClip: 'Inspect a clip to see its available metadata and download options.',
  previewAlt: 'Medal clip thumbnail',
  privacyNote:
    'The signed media URL stays on the server. Downloaded files expire automatically after a short period.',
};

export type MedalStrings = { [K in keyof typeof en]: string };

const kh: MedalStrings = {
  title: 'កម្មវិធីទាញយកវីដេអូ Medal.tv',
  subtitle:
    'ពិនិត្យឃ្លីបហ្គេម Medal.tv សាធារណៈ ហើយទាញយកឯកសារ MP4 ដើម នៅពេល Medal បង្ហាញវាជាសាធារណៈ។',
  languageButton: 'English',
  urlLabel: 'តំណភ្ជាប់ឃ្លីប Medal.tv',
  urlPlaceholder: 'https://medal.tv/games/game-name/clips/CLIP_ID',
  paste: 'បិទភ្ជាប់',
  inspect: 'ពិនិត្យឃ្លីប',
  inspecting: 'កំពុងពិនិត្យ…',
  invalidUrl: 'សូមបញ្ចូលតំណភ្ជាប់ Medal.tv ត្រឹមត្រូវ។ HTTP និងដែនបែបប្រហែលត្រូវបានបដិសេធ។',
  clipDetails: 'ព័ត៌មានឃ្លីប',
  creator: 'អ្នកបង្កើត',
  game: 'ហ្គេម',
  duration: 'រយៈពេល',
  uploaded: 'បានបង្ហោះ',
  format: 'ទម្រង់',
  resolution: 'គុណភាពបង្ហាញ',
  size: 'ទំហំ',
  clipId: 'លេខសម្គាល់ឃ្លីប',
  originalFormat: 'MP4 (ដើម)',
  unknownSize: 'មិនដឹងទំហំ',
  originalQuality: 'ឯកសារដើម',
  originalQualityHint:
    'MP4 សាធារណៈត្រូវបានរក្សាទុកដូចដើម ដោយមិនបំប្លែង ឬបង្កើនគុណភាព។',
  downloadAvailable: 'មាន MP4 ដើម',
  downloadUnavailable: 'មិនអាចទាញយកបាន',
  unavailableMessage: MEDAL_UNAVAILABLE_MESSAGE,
  unavailableKhmer:
    'ឃ្លីបនេះមិនអាចទាញយកបានតាមរយៈឧបករណ៍នេះទេ។ សូមបើកវានៅ Medal.tv ហើយប្រើជម្រើសទាញយកដែលមាននៅលើ Medal។',
  openOnMedal: 'បើកឃ្លីបនៅ Medal.tv',
  openGuide: 'ការណែនាំទាញយករបស់ Medal',
  officialNote:
    'Medal គ្រប់គ្រងលទ្ធភាពទាញយក។ ប្រសិនបើឯកសារដើមមិនមែនជាសាធារណៈ ឧបករណ៍នេះនឹងមិនឆ្លងកាត់ការកំណត់នោះទេ។',
  authorizationHeading: 'ការអនុញ្ញាតទាញយក',
  authorizationLabel: 'ខ្ញុំជាម្ចាស់ឃ្លីបនេះ ឬមានការអនុញ្ញាតឱ្យទាញយកវា។',
  authorizationHint:
    'មានតែឯកសារដើមសាធារណៈប៉ុណ្ណោះដែលត្រូវបានទាញយក។ មាតិកាឯកជន ពិសេស DRM ឬការកំណត់ចំនួនសំណើ មិនត្រូវបានឆ្លងកាត់ឡើយ។',
  startDownload: 'ទាញយក MP4 ដើម',
  starting: 'កំពុងចាប់ផ្តើម…',
  authorizationRequired: 'សូមបញ្ជាក់ថាអ្នកមានការអនុញ្ញាត មុនពេលចាប់ផ្តើមទាញយក។',
  jobHeading: 'ដំណើរការទាញយក',
  stateQueued: 'កំពុងរង់ចាំ',
  stateInspecting: 'កំពុងពិនិត្យនៅ Medal.tv',
  stateDownloading: 'កំពុងទាញយក MP4 ដើម',
  stateDone: 'រួចរាល់សម្រាប់ទាញយក',
  stateFailed: 'ការទាញយកបរាជ័យ',
  stateCancelled: 'បានបោះបង់',
  stateUnavailable: 'មិនអាចទាញយកបាន',
  ready: 'ឃ្លីបរបស់អ្នករួចរាល់ហើយ។',
  downloadFile: 'រក្សាទុក MP4',
  cancel: 'បោះបង់',
  retry: 'ពិនិត្យឡើងវិញ',
  progressUnknown: 'កំពុងទាញយក… Medal មិនបានរាយការណ៍ទំហំ',
  downloaded: 'បានទាញយក',
  of: 'ក្នុងចំណោម',
  rateLimited: 'Medal កំពុងកំណត់ចំនួនសំណើ។ សូមព្យាយាមម្តងទៀតក្នុងរយៈពេល {seconds} វិនាទី។',
  requestFailed: 'មានបញ្ហា។ សូមព្យាយាមម្តងទៀត។',
  jobExpired: 'ការទាញយកនេះផុតកំណត់ហើយ។ សូមពិនិត្យឃ្លីបម្តងទៀត។',
  unauthorized: 'ការទាញយកនេះជារបស់វគ្គផ្សេង។',
  noClip: 'ពិនិត្យឃ្លីប ដើម្បីមើលព័ត៌មាន និងជម្រើសទាញយកដែលមាន។',
  previewAlt: 'រូបភាពតូចឃ្លីប Medal',
  privacyNote:
    'តំណភ្ជាប់មេឌៀដែលបានចុះហត្ថលេខានៅលើម៉ាស៊ីនមេ។ ឯកសារដែលទាញយកនឹងផុតកំណត់ដោយស្វ័យប្រវត្តិក្នុងរយៈពេលខ្លី។',
};

export function medalStrings(lang: MedalLang): MedalStrings {
  return lang === 'kh' ? kh : en;
}
