/**
 * Planner memory-guard sanity checks (run with `npx tsx test/planner-memory-test.ts`).
 * MEMORY_LIMIT_MB overrides drive HardwareDetector.memoryBudgetMB() so the
 * matrix is reproducible on any machine.
 */
import { OptimizationPlanner } from '../src/services/OptimizationPlanner.js';
import { HardwareDetector } from '../src/services/HardwareDetector.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const meta1080p30 = {
  filename: 'test.mp4',
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 20,
  videoCodec: 'h264',
  audioCodec: 'aac',
  bitrateKbps: 3000,
  container: 'mp4',
} as any;

const meta4k30 = { ...meta1080p30, width: 3840, height: 2160 };

const tiktokSmart = { mode: 'smart', preset: 'tiktok', targetResolution: 'tiktok_1080x1920', targetFps: 60, motion: '60fps' } as any;
const tiktokSmart4k = { ...tiktokSmart, preset: 'youtube_4k', targetResolution: '4k' } as any;

let failures = 0;
function check(label: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`✓ ${label}`);
  } else {
    failures++;
    console.error(`✗ ${label} — ${detail}`);
  }
}

for (const budget of [512, 1024, 2048, 8192, 16384]) {
  process.env.MEMORY_LIMIT_MB = String(budget);
  // Bare metal path reads os.totalmem/hosts; reset caches by re-import not needed
  // because memoryBudgetMB() caches — use a fresh process trick: values cached in class.
}
// Cache makes batching impossible; run separate scenarios via single budget each.
function planFor(budget: number, meta: any, config: any) {
  (HardwareDetector as any).cachedMemoryBudgetMB = budget;
  return OptimizationPlanner.plan(meta, config, false);
}

{
  const plan = planFor(512, meta1080p30, tiktokSmart);
  check(
    '512MB: tiktok smart plan avoids MCI',
    plan.filters.interpolateMode === 'blend',
    `got ${plan.filters.interpolateMode}`
  );
  check('512MB: threads budget is 1', HardwareDetector.threadBudget() === 1, `got ${HardwareDetector.threadBudget()}`);
}

{
  const plan = planFor(512, meta4k30, tiktokSmart4k);
  check(
    '512MB: 4K target capped to 1080p',
    plan.config.targetResolution === '1080p' && plan.filters.scaleWidth === 1920,
    `got ${plan.config.targetResolution} ${plan.filters.scaleWidth}`
  );
}

{
  const plan = planFor(2048, meta1080p30, tiktokSmart);
  check(
    '2GB: tiktok smart plan avoids MCI (1080p@60 needs ~2.5GB)',
    plan.filters.interpolateMode === 'blend',
    `got ${plan.filters.interpolateMode}`
  );
}

{
  const plan = planFor(16384, meta1080p30, tiktokSmart);
  check(
    '16GB: tiktok smart plan allows MCI',
    plan.filters.interpolateMode === 'mci',
    `got ${plan.filters.interpolateMode}`
  );
}

{
  const plan = planFor(16384, meta4k30, tiktokSmart4k);
  check(
    '16GB: 4K target preserved',
    plan.config.targetResolution === '4k' && plan.filters.scaleWidth === 3840,
    `got ${plan.config.targetResolution} ${plan.filters.scaleWidth}`
  );
  check(
    '16GB: 4K source avoids MCI (needs ~10GB)',
    plan.filters.interpolateMode === 'blend',
    `got ${plan.filters.interpolateMode}`
  );
}

{
  const plan = planFor(1024, meta1080p30, { ...tiktokSmart, mode: 'fast' });
  check(
    '1GB: fast mode stays blend (never MCI)',
    plan.filters.interpolateMode === 'blend',
    `got ${plan.filters.interpolateMode}`
  );
}

{
  (HardwareDetector as any).cachedMemoryBudgetMB = 512;
  check(
    '512MB: ffmpeg watchdog limit leaves room for Node (320MB)',
    HardwareDetector.ffmpegMemoryLimitMB() === 320,
    `got ${HardwareDetector.ffmpegMemoryLimitMB()}`
  );
}

{
  (HardwareDetector as any).cachedMemoryBudgetMB = 8192;
  check(
    '8GB: ffmpeg watchdog disabled',
    HardwareDetector.ffmpegMemoryLimitMB() === 0,
    `got ${HardwareDetector.ffmpegMemoryLimitMB()}`
  );
}

{
  // Regression guard for the old `1 << 42` bug: JS bitwise shifts are 32-bit,
  // so that expression is 1024 and discarded every real cgroup limit.
  const tmp = path.join(os.tmpdir(), `cgroup-limit-${process.pid}.txt`);
  try {
    fs.writeFileSync(tmp, '536870912');
    check(
      '512MB cgroup limit is accepted',
      (HardwareDetector as any).readMemoryLimitFile(tmp) === 536870912,
      'real limit was discarded'
    );

    fs.writeFileSync(tmp, '9223372036854771712');
    check(
      'cgroup v1 unlimited sentinel is ignored',
      (HardwareDetector as any).readMemoryLimitFile(tmp) === 0,
      'sentinel was treated as a real limit'
    );

    fs.writeFileSync(tmp, 'max');
    check(
      'cgroup v2 "max" is ignored',
      (HardwareDetector as any).readMemoryLimitFile(tmp) === 0,
      'max was treated as a real limit'
    );
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
  }
}

if (failures > 0) {
  process.exit(1);
}
console.log('All planner memory checks passed.');
