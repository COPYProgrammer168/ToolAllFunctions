/**
 * Localisation for the QR Studio view.
 *
 * The rest of the app localises with inline `lang === 'en' ? … : …` ternaries,
 * but this view has far more copy than any existing screen, so a flat
 * dictionary keeps the markup readable. Khmer is a first-class second language
 * here, matching PDF to Word and Captions.
 */

export type Lang = 'en' | 'kh';

export interface QrStrings {
  title: string;
  subtitle: string;
  contentType: string;
  content: string;

  // content types
  typeUrl: string;
  typeText: string;
  typeFile: string;
  typeWifi: string;
  typeVcard: string;
  typeEmail: string;
  typeSms: string;
  typePhone: string;
  typeEvent: string;
  typeGeo: string;

  urlLabel: string;
  urlPlaceholder: string;
  textLabel: string;
  textPlaceholder: string;
  phoneLabel: string;

  // file
  fileHelp: string;
  chooseFile: string;
  uploading: string;
  hostedLink: string;
  uploaded: string;

  // wifi
  networkName: string;
  wifiPassword: string;
  encryption: string;
  encryptionOpen: string;
  hiddenNetwork: string;

  // vcard
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  emailAddress: string;
  website: string;
  address: string;
  note: string;

  // email
  recipient: string;
  subject: string;
  message: string;

  // event
  eventTitle: string;
  location: string;
  startTime: string;
  endTime: string;
  description: string;

  // geo
  latitude: string;
  longitude: string;

  // design
  design: string;
  presets: string;
  applyPreset: string;
  savePreset: string;
  presetName: string;
  colors: string;
  foreground: string;
  background: string;
  useGradient: string;
  gradientType: string;
  gradientLinear: string;
  gradientRadial: string;
  gradientAngle: string;
  stopColor: string;
  dotStyle: string;
  cornerStyle: string;
  cornerDotStyle: string;
  errorCorrection: string;
  margin: string;
  size: string;
  logo: string;
  uploadLogo: string;
  removeLogo: string;
  logoSize: string;
  logoPadding: string;
  logoRadius: string;
  hideDotsBehindLogo: string;
  noLogo: string;
  frame: string;
  addFrame: string;
  caption: string;
  captionPlaceholder: string;

  // shapes
  shapeSquare: string;
  shapeDots: string;
  shapeRounded: string;
  shapeExtraRounded: string;
  shapeClassy: string;
  shapeClassyRounded: string;
  shapeDot: string;

  // actions
  exportPng: string;
  exportJpg: string;
  exportSvg: string;
  exportPdf: string;
  copyImage: string;
  copied: string;
  scanCheck: string;
  scanning: string;
  scannable: string;
  notScannable: string;
  densePayload: string;

  // library
  saveToLibrary: string;
  library: string;
  noSaved: string;
  favorites: string;
  searchPlaceholder: string;
  open: string;
  delete: string;
  clearAll: string;

  // batch
  batch: string;
  batchHelp: string;
  batchPlaceholder: string;
  batchGenerate: string;
  batchCsv: string;
  entriesFound: string;

  // sheet
  sheet: string;
  copies: string;
  columns: string;
  paper: string;
  rowGap: string;
  sheetMargin: string;
  showLabels: string;
  buildSheet: string;

  // misc
  preview: string;
  startOver: string;
  emptyHint: string;
  errorFixFirst: string;
  exportFailed: string;
}

export const QR_STRINGS: Record<Lang, QrStrings> = {
  en: {
    title: 'QR Studio',
    subtitle: 'Build scannable QR codes from a URL, a file link, Wi-Fi, a contact card and more — then brand them with your own logo and colours.',
    contentType: 'Content type',
    content: 'Content',

    typeUrl: 'URL',
    typeText: 'Text',
    typeFile: 'File link',
    typeWifi: 'Wi-Fi',
    typeVcard: 'Contact',
    typeEmail: 'Email',
    typeSms: 'SMS',
    typePhone: 'Phone',
    typeEvent: 'Event',
    typeGeo: 'Location',

    urlLabel: 'Website or link',
    urlPlaceholder: 'example.com or https://example.com/page',
    textLabel: 'Text to encode',
    textPlaceholder: 'Any text — a coupon code, a message, a serial number',
    phoneLabel: 'Phone number',

    fileHelp: 'Upload an image, video, audio file or PDF. The code will link to it so a phone can open it.',
    chooseFile: 'Choose a file',
    uploading: 'Uploading',
    hostedLink: 'Hosted link',
    uploaded: 'File uploaded',

    networkName: 'Network name (SSID)',
    wifiPassword: 'Password',
    encryption: 'Security',
    encryptionOpen: 'Open (no password)',
    hiddenNetwork: 'Hidden network',

    firstName: 'First name',
    lastName: 'Last name',
    company: 'Company',
    jobTitle: 'Job title',
    emailAddress: 'Email',
    website: 'Website',
    address: 'Address',
    note: 'Note',

    recipient: 'To',
    subject: 'Subject',
    message: 'Message',

    eventTitle: 'Event title',
    location: 'Location',
    startTime: 'Starts',
    endTime: 'Ends',
    description: 'Description',

    latitude: 'Latitude',
    longitude: 'Longitude',

    design: 'Design',
    presets: 'Presets',
    applyPreset: 'Apply',
    savePreset: 'Save current as preset',
    presetName: 'Preset name',
    colors: 'Colours',
    foreground: 'Code colour',
    background: 'Background',
    useGradient: 'Use gradient',
    gradientType: 'Type',
    gradientLinear: 'Linear',
    gradientRadial: 'Radial',
    gradientAngle: 'Angle',
    stopColor: 'Colour',
    dotStyle: 'Module shape',
    cornerStyle: 'Corner frame',
    cornerDotStyle: 'Corner centre',
    errorCorrection: 'Error correction',
    margin: 'Quiet zone (modules)',
    size: 'Export size',
    logo: 'Centre logo',
    uploadLogo: 'Upload logo',
    removeLogo: 'Remove',
    logoSize: 'Logo size',
    logoPadding: 'Logo padding',
    logoRadius: 'Plate roundness',
    hideDotsBehindLogo: 'Clear modules behind logo',
    noLogo: 'No logo',
    frame: 'Frame & caption',
    addFrame: 'Add a border',
    caption: 'Caption',
    captionPlaceholder: 'SCAN ME',

    shapeSquare: 'Square',
    shapeDots: 'Dots',
    shapeRounded: 'Rounded',
    shapeExtraRounded: 'Extra rounded',
    shapeClassy: 'Classy',
    shapeClassyRounded: 'Classy rounded',
    shapeDot: 'Dot',

    exportPng: 'PNG',
    exportJpg: 'JPG',
    exportSvg: 'SVG',
    exportPdf: 'PDF sheet',
    copyImage: 'Copy image',
    copied: 'Copied to clipboard',
    scanCheck: 'Scan check',
    scanning: 'Checking…',
    scannable: 'Scannable — the decoder read this code correctly.',
    notScannable: 'Not scannable',
    densePayload: 'This payload is long, so the code is dense. Test it at print size before mass printing.',

    saveToLibrary: 'Save to library',
    library: 'Saved codes',
    noSaved: 'Nothing saved yet. Generate a code and press “Save to library”.',
    favorites: 'Favourites only',
    searchPlaceholder: 'Search saved codes',
    open: 'Open',
    delete: 'Delete',
    clearAll: 'Clear all',

    batch: 'Batch from list',
    batchHelp: 'One URL per line. Use label,url for a named file, and # for comments.',
    batchPlaceholder: 'promo,example.com/sale\nhttps://example.com/about',
    batchGenerate: 'Generate ZIP',
    batchCsv: 'Download CSV',
    entriesFound: 'entries',

    sheet: 'Print sheet',
    copies: 'Copies',
    columns: 'Columns',
    paper: 'Paper',
    rowGap: 'Row gap (mm)',
    sheetMargin: 'Margin (mm)',
    showLabels: 'Print captions',
    buildSheet: 'Build PDF',

    preview: 'Preview',
    startOver: 'Start over',
    emptyHint: 'Fill in the content on the left to generate a code.',
    errorFixFirst: 'Fix the highlighted problem before exporting.',
    exportFailed: 'Export failed',
  },
  kh: {
    title: 'ស្ទូឌីយោ QR',
    subtitle: 'បង្កើតកូដ QR ដែលអាចស្កេនបានពី URL តំណឯកសារ Wi-Fi កាតទំនាក់ទំនង និងច្រើនទៀត — បន្ទាប់មកតុបតែងដោយឡូហ្គោ និងពណ៌ផ្ទាល់ខ្លួន។',
    contentType: 'ប្រភេទខ្លឹមសារ',
    content: 'ខ្លឹមសារ',

    typeUrl: 'URL',
    typeText: 'អក្សរ',
    typeFile: 'តំណឯកសារ',
    typeWifi: 'Wi-Fi',
    typeVcard: 'ទំនាក់ទំនង',
    typeEmail: 'អ៊ីមែល',
    typeSms: 'សារ SMS',
    typePhone: 'ទូរស័ព្ទ',
    typeEvent: 'ព្រឹត្តិការណ៍',
    typeGeo: 'ទីតាំង',

    urlLabel: 'គេហទំព័រ ឬតំណ',
    urlPlaceholder: 'example.com ឬ https://example.com/page',
    textLabel: 'អក្សរដែលត្រូវដាក់ក្នុងកូដ',
    textPlaceholder: 'អក្សរណាមួយ — លេខកូដបញ្ចុះតម្លៃ សារ ឬលេខសម្គាល់',
    phoneLabel: 'លេខទូរស័ព្ទ',

    fileHelp: 'ផ្ទុកឡើងរូបភាព វីដេអូ សំឡេង ឬ PDF។ កូដនឹងភ្ជាប់ទៅឯកសារនោះ ដើម្បីឱ្យទូរស័ព្ទបើកបាន។',
    chooseFile: 'ជ្រើសរើសឯកសារ',
    uploading: 'កំពុងផ្ទុកឡើង',
    hostedLink: 'តំណដែលបានផ្ទុក',
    uploaded: 'ឯកសារបានផ្ទុករួច',

    networkName: 'ឈ្មោះបណ្តាញ (SSID)',
    wifiPassword: 'ពាក្យសម្ងាត់',
    encryption: 'សុវត្ថិភាព',
    encryptionOpen: 'បើក (គ្មានពាក្យសម្ងាត់)',
    hiddenNetwork: 'បណ្តាញលាក់',

    firstName: 'នាម',
    lastName: 'គោត្តនាម',
    company: 'ក្រុមហ៊ុន',
    jobTitle: 'មុខតំណែង',
    emailAddress: 'អ៊ីមែល',
    website: 'គេហទំព័រ',
    address: 'អាសយដ្ឋាន',
    note: 'កំណត់សម្គាល់',

    recipient: 'អ្នកទទួល',
    subject: 'ប្រធានបទ',
    message: 'សារ',

    eventTitle: 'ចំណងជើងព្រឹត្តិការណ៍',
    location: 'ទីតាំង',
    startTime: 'ចាប់ផ្តើម',
    endTime: 'បញ្ចប់',
    description: 'ការពិពណ៌នា',

    latitude: 'រយៈទទឹង',
    longitude: 'រយៈបណ្តោយ',

    design: 'ការរចនា',
    presets: 'កំណត់ជាមុន',
    applyPreset: 'អនុវត្ត',
    savePreset: 'រក្សាទុកជាកំណត់ជាមុន',
    presetName: 'ឈ្មោះកំណត់ជាមុន',
    colors: 'ពណ៌',
    foreground: 'ពណ៌កូដ',
    background: 'ផ្ទៃខាងក្រោយ',
    useGradient: 'ប្រើជម្រាលពណ៌',
    gradientType: 'ប្រភេទ',
    gradientLinear: 'បន្ទាត់ត្រង់',
    gradientRadial: 'រាងជារង្វង់',
    gradientAngle: 'មុំ',
    stopColor: 'ពណ៌',
    dotStyle: 'រាងម៉ូឌុល',
    cornerStyle: 'ស៊ុមជ្រុង',
    cornerDotStyle: 'ចំណុចកណ្តាលជ្រុង',
    errorCorrection: 'ការកែតម្រូវកំហុស',
    margin: 'តំបន់ស្ងាត់ (ម៉ូឌុល)',
    size: 'ទំហំនាំចេញ',
    logo: 'ឡូហ្គោកណ្តាល',
    uploadLogo: 'ផ្ទុកឡូហ្គោ',
    removeLogo: 'លុប',
    logoSize: 'ទំហំឡូហ្គោ',
    logoPadding: 'គម្លាតឡូហ្គោ',
    logoRadius: 'ភាពមូលនៃផ្ទាំង',
    hideDotsBehindLogo: 'លុបម៉ូឌុលពីក្រោយឡូហ្គោ',
    noLogo: 'គ្មានឡូហ្គោ',
    frame: 'ស៊ុម និងចំណងជើងរង',
    addFrame: 'បន្ថែមស៊ុម',
    caption: 'ចំណងជើងរង',
    captionPlaceholder: 'ស្កេនខ្ញុំ',

    shapeSquare: 'ការ៉េ',
    shapeDots: 'ចំណុច',
    shapeRounded: 'មូល',
    shapeExtraRounded: 'មូលខ្លាំង',
    shapeClassy: 'បែបបុរាណ',
    shapeClassyRounded: 'បែបបុរាណមូល',
    shapeDot: 'ចំណុច',

    exportPng: 'PNG',
    exportJpg: 'JPG',
    exportSvg: 'SVG',
    exportPdf: 'សន្លឹក PDF',
    copyImage: 'ចម្លងរូបភាព',
    copied: 'បានចម្លងទៅក្តារតម្បៀតខ្ទាស់',
    scanCheck: 'ពិនិត្យការស្កេន',
    scanning: 'កំពុងពិនិត្យ…',
    scannable: 'អាចស្កេនបាន — ឧបករណ៍អានបានអានកូដនេះត្រឹមត្រូវ។',
    notScannable: 'មិនអាចស្កេនបាន',
    densePayload: 'ខ្លឹមសារនេះវែង ដូច្នេះកូដមានដង់ស៊ីតេខ្ពស់។ សាកល្បងបោះពុម្ពមុននឹងបោះពុម្ពច្រើន។',

    saveToLibrary: 'រក្សាទុកទៅបណ្ណាល័យ',
    library: 'កូដដែលបានរក្សាទុក',
    noSaved: 'មិនទាន់មានអ្វីរក្សាទុកទេ។ បង្កើតកូដមួយ រួចចុច “រក្សាទុកទៅបណ្ណាល័យ”។',
    favorites: 'តែចំណូលចិត្ត',
    searchPlaceholder: 'ស្វែងរកកូដដែលបានរក្សាទុក',
    open: 'បើក',
    delete: 'លុប',
    clearAll: 'លុបទាំងអស់',

    batch: 'បង្កើតជាក្រុមពីបញ្ជី',
    batchHelp: 'URL មួយក្នុងមួយបន្ទាត់។ ប្រើ label,url សម្រាប់ឈ្មោះឯកសារ និង # សម្រាប់មតិយោបល់។',
    batchPlaceholder: 'promo,example.com/sale\nhttps://example.com/about',
    batchGenerate: 'បង្កើត ZIP',
    batchCsv: 'ទាញយក CSV',
    entriesFound: 'ជួរ',

    sheet: 'សន្លឹកសម្រាប់បោះពុម្ព',
    copies: 'ច្បាប់ចម្លង',
    columns: 'ជួរឈរ',
    paper: 'ក្រដាស',
    rowGap: 'គម្លាតជួរ (មម)',
    sheetMargin: 'រឹម (មម)',
    showLabels: 'បោះពុម្ពចំណងជើងរង',
    buildSheet: 'បង្កើត PDF',

    preview: 'មើលជាមុន',
    startOver: 'ចាប់ផ្តើមឡើងវិញ',
    emptyHint: 'បំពេញខ្លឹមសារនៅខាងឆ្វេង ដើម្បីបង្កើតកូដ។',
    errorFixFirst: 'ដោះស្រាយបញ្ហាដែលបានបង្ហាញ មុននឹងនាំចេញ។',
    exportFailed: 'ការនាំចេញបានបរាជ័យ',
  },
};

export function stringsFor(lang: Lang): QrStrings {
  return QR_STRINGS[lang] ?? QR_STRINGS.en;
}
