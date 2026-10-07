import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { VideoAnalyzer } from '../src/services/VideoAnalyzer.js';
import { OptimizationPlanner } from '../src/services/OptimizationPlanner.js';
import { FFmpegService } from '../src/services/FFmpegService.js';
import { QualityValidator } from '../src/services/QualityValidator.js';
import { HardwareDetector } from '../src/services/HardwareDetector.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.resolve(__dirname, 'temp_test');

async function runTest() {
  console.log('=== Running Video Optimizer Test Suite ===');
  await fs.mkdir(TEST_DIR, { recursive: true });

  const testVideoPath = path.join(TEST_DIR, 'source_test.mp4');
  const testOutputPath = path.join(TEST_DIR, 'optimized_test.mp4');

  // 1. Generate 3-second 720p 30fps test video with audio
  console.log('1. Generating synthetic 720p 30fps test video with audio...');
  const genCmd = `ffmpeg -y -f lavfi -i testsrc=duration=3:size=1280x720:rate=30 -f lavfi -i sine=frequency=1000:duration=3 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 128k "${testVideoPath}"`;
  await execAsync(genCmd);

  // 2. Test Hardware Detection
  console.log('2. Detecting Hardware...');
  const hw = await HardwareDetector.detect();
  console.log(`Detected GPU: ${hw.hasNvidiaGpu ? hw.gpuName : 'None'}, Recommended: ${hw.recommendedEncoder}`);

  // 3. Test Video Analysis
  console.log('3. Analyzing Video...');
  const report = await VideoAnalyzer.analyze(testVideoPath, 'sample_gaming_clip.mp4');
  console.log(`Resolution: ${report.metadata.width}x${report.metadata.height}, FPS: ${report.metadata.fps}, Duration: ${report.metadata.duration}s`);
  console.log(`Quality Score: ${report.qualityScore.overall}/100 (Res: ${report.qualityScore.resolution}, Mot: ${report.qualityScore.motion})`);
  console.log(`Detected problems:`, report.detectedProblems);
  console.log(`Recommendation summary:`, report.recommendations.summary);

  // 4. Test Optimization Planning for TikTok preset
  console.log('4. Planning TikTok optimization (1080x1920 60fps blur background)...');
  const plan = OptimizationPlanner.plan(report.metadata, {
    mode: 'smart',
    preset: 'tiktok',
    scenario: 'gaming',
    aspectRatioStrategy: 'blur_background',
    motion: '60fps',
  }, hw.hasNvidiaGpu);
  console.log('Planned filters:', plan.filters);
  console.log('Warnings:', plan.warnings);

  // 5. Test FFmpeg Processing Pipeline
  console.log('5. Executing Processing Engine...');
  const ffmpeg = new FFmpegService();
  await ffmpeg.processVideo(
    'test-job-1',
    testVideoPath,
    testOutputPath,
    report.metadata,
    plan,
    (p) => {
      console.log(`Progress: ${p.percent}% | Frame: ${p.currentFrame} | Speed: ${p.speed} | Stage: ${p.stageName}`);
    }
  );

  // 6. Test Quality Validation
  console.log('6. Validating Output...');
  const validation = await QualityValidator.validate(testOutputPath, report.metadata);
  console.log('Validation Report:', validation);

  if (validation.passed) {
    console.log('SUCCESS! Video Optimization Pipeline passed all tests!');
  } else {
    console.error('Validation failed with warnings:', validation.warnings);
  }

  // Cleanup test files
  await fs.rm(TEST_DIR, { recursive: true, force: true });
}

runTest().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
