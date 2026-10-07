export class OptimizationPlanner {
    static plan(meta, userConfig, hasGpu) {
        const mode = userConfig.mode || 'smart';
        const scenario = userConfig.scenario || 'realistic';
        const isLandscape = meta.width > meta.height;
        // Default configuration template
        let config = {
            mode,
            scenario,
            preset: userConfig.preset || 'tiktok',
            targetResolution: userConfig.targetResolution || (userConfig.preset === 'tiktok' ? 'tiktok_1080x1920' : 'original'),
            targetFps: userConfig.targetFps || 60,
            aspectRatioStrategy: userConfig.aspectRatioStrategy || (isLandscape ? 'blur_background' : 'preserve'),
            detail: userConfig.detail || 'natural',
            denoise: userConfig.denoise || 'low',
            deblocking: userConfig.deblocking !== undefined ? userConfig.deblocking : true,
            debanding: userConfig.debanding !== undefined ? userConfig.debanding : false,
            motion: userConfig.motion || '60fps',
            color: userConfig.color || 'natural',
            audio: userConfig.audio || 'optimized',
            loudnessNormalization: userConfig.loudnessNormalization !== undefined ? userConfig.loudnessNormalization : true,
            isPreview: userConfig.isPreview || false,
            previewDuration: userConfig.previewDuration || 5,
        };
        const warnings = [];
        // Adjust based on Mode
        if (mode === 'preserve_original') {
            config.targetResolution = 'original';
            config.targetFps = 'original';
            config.detail = 'off';
            config.denoise = 'off';
            config.deblocking = false;
            config.debanding = false;
            config.motion = 'off';
            config.color = 'original';
            config.audio = 'original';
            config.aspectRatioStrategy = 'preserve';
            config.loudnessNormalization = false;
            warnings.push('Preserve Original: Original resolution, framing, and framerate are kept without AI enhancement.');
        }
        else if (mode === 'fast') {
            config.detail = 'soft';
            config.denoise = 'low';
            config.debanding = false;
            if (meta.fps >= 50)
                config.motion = 'off';
        }
        else if (mode === 'max_quality') {
            config.detail = 'sharp';
            config.denoise = 'medium';
            config.deblocking = true;
            config.debanding = true;
            config.motion = '60fps';
        }
        // Scenario specific tuning
        if (scenario === 'gaming') {
            config.denoise = 'off'; // Preserve small UI details & HUD
            config.detail = 'sharp';
            if (config.color === 'natural')
                config.color = 'vibrant';
        }
        else if (scenario === 'vlog') {
            config.detail = 'natural'; // Keep skin textures natural
            config.color = 'natural';
        }
        else if (scenario === 'low_light') {
            config.denoise = 'medium';
            config.deblocking = true;
        }
        // Determine target dimensions
        let scaleWidth;
        let scaleHeight;
        let upscalingMethod = 'none';
        if (config.preset === 'tiktok' || config.targetResolution === 'tiktok_1080x1920') {
            scaleWidth = 1080;
            scaleHeight = 1920;
            if (meta.width < 1080 && meta.height < 1920) {
                upscalingMethod = 'lanczos';
            }
        }
        else if (config.targetResolution === '4k') {
            scaleWidth = isLandscape ? 3840 : 2160;
            scaleHeight = isLandscape ? 2160 : 3840;
            if (meta.width < 3840 && meta.height < 2160) {
                upscalingMethod = 'lanczos';
                warnings.push('Upscaling to 4K: Output resolution will increase, but original detail cannot be fully recreated.');
            }
        }
        else if (config.targetResolution === '1080p') {
            scaleWidth = isLandscape ? 1920 : 1080;
            scaleHeight = isLandscape ? 1080 : 1920;
            if (meta.width < 1080 && meta.height < 1080) {
                upscalingMethod = 'lanczos';
            }
        }
        else if (config.targetResolution === '720p') {
            scaleWidth = isLandscape ? 1280 : 720;
            scaleHeight = isLandscape ? 720 : 1280;
        }
        // Determine target FPS & Interpolation
        let targetFps = meta.fps;
        let interpolateMode = 'none';
        if (config.targetFps === 60 || config.motion === '60fps' || config.motion === 'very_smooth') {
            if (meta.fps < 50) {
                targetFps = 60;
                interpolateMode = mode === 'fast' ? 'blend' : 'mci';
                warnings.push(`Frame Interpolation: Synthesizing intermediate frames (${meta.fps} → 60 FPS). Fast erratic motion may show slight blending.`);
            }
            else {
                targetFps = Math.round(meta.fps);
                interpolateMode = 'none';
            }
        }
        else if (typeof config.targetFps === 'number') {
            targetFps = config.targetFps;
            if (targetFps > meta.fps + 5) {
                interpolateMode = 'mci';
            }
        }
        // Calculate Adaptive Bitrate
        const outPixels = (scaleWidth || meta.width) * (scaleHeight || meta.height);
        let baseBpp = 0.12;
        if (scenario === 'gaming')
            baseBpp = 0.18;
        if (mode === 'max_quality')
            baseBpp = 0.16;
        if (mode === 'fast')
            baseBpp = 0.10;
        let targetBitrateKbps = Math.round((outPixels * targetFps * baseBpp) / 1000);
        // TikTok cap recommendation: ~12,000 - 18,000 kbps for 1080x1920 60fps
        if (scaleWidth === 1080 && scaleHeight === 1920) {
            targetBitrateKbps = Math.min(18000, Math.max(8000, targetBitrateKbps));
        }
        else if (scaleWidth === 3840 || scaleHeight === 3840) {
            targetBitrateKbps = Math.min(45000, Math.max(22000, targetBitrateKbps));
        }
        else {
            targetBitrateKbps = Math.min(25000, Math.max(5000, targetBitrateKbps));
        }
        // Encoding parameters
        const encoding = {
            videoCodec: 'libx264',
            audioCodec: 'aac',
            crf: mode === 'max_quality' ? 17 : (mode === 'fast' ? 22 : 19),
            videoBitrateKbps: targetBitrateKbps,
            audioBitrateKbps: 256,
            preset: mode === 'fast' ? 'faster' : (mode === 'max_quality' ? 'slow' : 'medium'),
            profile: 'high',
            level: '4.2',
            pixFmt: 'yuv420p',
        };
        let explanation = `Pipeline optimized for ${mode.replace('_', ' ')} mode in ${scenario} scenario.`;
        if (config.aspectRatioStrategy === 'blur_background' && isLandscape) {
            explanation += ' Applying 9:16 vertical canvas with blurred background fill to preserve entire landscape frame.';
        }
        return {
            config,
            filters: {
                deblock: config.deblocking,
                deband: config.debanding,
                denoise: config.denoise,
                sharpen: config.detail,
                scaleWidth,
                scaleHeight,
                upscalingMethod,
                targetFps,
                interpolateMode,
                aspectRatioStrategy: config.aspectRatioStrategy,
                colorProfile: config.color,
                audioNormalization: config.loudnessNormalization,
            },
            encoding,
            warnings,
            explanation,
        };
    }
}
