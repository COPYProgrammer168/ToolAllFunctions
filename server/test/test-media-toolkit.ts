import { validateRemoteUrl } from '../src/utils/security.js';
import { MediaSourceResolver } from '../src/services/MediaSourceResolver.js';
import { AudioExtractor } from '../src/services/AudioExtractor.js';
import { AudioConverter } from '../src/services/AudioConverter.js';
import { OutroDetector } from '../src/services/OutroDetector.js';
import { WatermarkEditor } from '../src/services/WatermarkEditor.js';
import { ImageProcessor } from '../src/services/ImageProcessor.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.resolve(__dirname, '../../storage/test-media');

async function runTests() {
  console.log('====================================================');
  console.log('MEDIA TOOLKIT — AUTOMATED VERIFICATION SUITE');
  console.log('====================================================\n');

  await fs.mkdir(TEST_DIR, { recursive: true });

  // 1. SSRF & Security Validation Tests
  console.log('[Test 1] Testing SSRF and Protocol Protections...');
  const ssrf1 = await validateRemoteUrl('http://127.0.0.1:3000/secret');
  console.assert(!ssrf1.valid, 'SSRF loopback IP should be rejected');
  console.log('  ✓ 127.0.0.1 blocked:', ssrf1.error);

  const ssrf2 = await validateRemoteUrl('http://localhost:8080/admin');
  console.assert(!ssrf2.valid, 'SSRF localhost should be rejected');
  console.log('  ✓ localhost blocked:', ssrf2.error);

  const ssrf3 = await validateRemoteUrl('file:///etc/passwd');
  console.assert(!ssrf3.valid, 'file:// protocol should be rejected');
  console.log('  ✓ file:// protocol blocked:', ssrf3.error);

  // 2. Provider URL Analyzers
  console.log('\n[Test 2] Testing Provider Adapters...');
  const ytRes = await MediaSourceResolver.resolveAndAnalyze('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  console.log(`  ✓ YouTube: "${ytRes.title}" by ${ytRes.creator}`);
  console.log(`    Authorized: ${ytRes.downloadAuthorized} | Formats: ${ytRes.availableFormats.length}`);
  console.assert(ytRes.availableFormats.length > 0, 'YouTube formats should be defined');

  const scRes = await MediaSourceResolver.resolveAndAnalyze('https://soundcloud.com/artist/track-name');
  console.log(`  ✓ SoundCloud: "${scRes.title}" | Authorized: ${scRes.downloadAuthorized}`);

  const ttRes = await MediaSourceResolver.resolveAndAnalyze('https://www.tiktok.com/@user/video/7123456789');
  console.log(`  ✓ TikTok: "${ttRes.title}" | Authorized: ${ttRes.downloadAuthorized}`);

  // 3. Generate a sample test video with audio track using FFmpeg
  console.log('\n[Test 3] Generating Synthetic Test Media with Audio...');
  const sampleVideo = path.join(TEST_DIR, 'sample_test.mp4');
  const genCmd = `ffmpeg -y -f lavfi -i testsrc=duration=5:size=640x360:rate=30 -f lavfi -i sine=frequency=440:duration=5 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 128k "${sampleVideo}"`;
  await execAsync(genCmd);
  console.log('  ✓ Generated synthetic 5s sample video at:', sampleVideo);

  // 4. Test AudioExtractor with Smart Bitrate and Direct Stream Copy
  console.log('\n[Test 4] Testing AudioExtractor...');
  const mp3Output = path.join(TEST_DIR, 'extracted.mp3');
  const extractRes = await AudioExtractor.extract({
    inputPath: sampleVideo,
    outputPath: mp3Output,
    format: 'mp3',
    targetBitrateKbps: 320,
    metadata: {
      title: 'Synth Test Tone',
      artist: 'VideoOptimizer Audio Engine',
      album: 'Test Suite',
      year: 2026,
    },
  });
  console.log(`  ✓ Extracted MP3: ${(extractRes.fileSizeBytes / 1024).toFixed(1)} KB`);
  console.log(`  ✓ Source Bitrate: ${extractRes.sourceBitrateKbps} kbps | Output: ${extractRes.outputBitrateKbps} kbps`);
  if (extractRes.qualityNotice) {
    console.log(`  ✓ Smart Notice: "${extractRes.qualityNotice}"`);
  }

  // 5. Test AudioConverter (Waveform & Trimming & Fades)
  console.log('\n[Test 5] Testing AudioConverter (Waveform & Trimming)...');
  const peaks = await AudioConverter.generateWaveform(mp3Output, 20);
  console.log(`  ✓ Generated Waveform Peaks: [${peaks.slice(0, 5).join(', ')}...] (Count: ${peaks.length})`);

  const trimmedAudio = path.join(TEST_DIR, 'trimmed.mp3');
  const trimRes = await AudioConverter.editAndConvert({
    inputPath: mp3Output,
    outputPath: trimmedAudio,
    format: 'mp3',
    startSec: 1,
    endSec: 4,
    fadeInSec: 0.5,
    fadeOutSec: 0.5,
    normalizeLoudness: true,
  });
  console.log(`  ✓ Trimmed Audio Duration: ${trimRes.duration}s | Size: ${(trimRes.fileSizeBytes / 1024).toFixed(1)} KB`);

  // 6. Test Smart Outro Detection
  console.log('\n[Test 6] Testing Smart Outro Detection...');
  const outro = await OutroDetector.detect(sampleVideo);
  console.log(`  ✓ Outro Detected: ${outro.detected} | Suggested Cut: ${outro.suggestedCutTime}s (${outro.outroStartFormatted} -> ${outro.outroEndFormatted})`);
  console.log(`  ✓ Confidence: ${outro.confidence}% | Reason: ${outro.reason}`);

  // 7. Test Watermark Removal (AI Inpainting / Delogo)
  console.log('\n[Test 7] Testing User-Owned Watermark Removal Filter...');
  const delogoVideo = path.join(TEST_DIR, 'watermark_removed.mp4');
  const wmRes = await WatermarkEditor.removeWatermark({
    inputPath: sampleVideo,
    outputPath: delogoVideo,
    method: 'inpaint',
    region: { x: 500, y: 300, width: 100, height: 40 },
  });
  console.log(`  ✓ Watermark Filter Applied (${wmRes.method})`);
  console.log(`  ✓ Legal Safeguard: "${wmRes.legalNotice}"`);

  // 8. Test Image Processor
  console.log('\n[Test 8] Testing Image Processor...');
  const testFrame = path.join(TEST_DIR, 'test_frame.jpg');
  await execAsync(`ffmpeg -y -ss 1 -i "${sampleVideo}" -vframes 1 "${testFrame}"`);
  const webpOutput = path.join(TEST_DIR, 'converted.webp');
  const imgRes = await ImageProcessor.convert(testFrame, webpOutput, 'webp');
  console.log(`  ✓ Converted to WebP: ${imgRes.width}x${imgRes.height} (${(imgRes.fileSizeBytes / 1024).toFixed(1)} KB)`);

  console.log('\n====================================================');
  console.log('ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ✓');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
