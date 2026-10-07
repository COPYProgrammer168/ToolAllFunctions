import { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Download, Sparkles } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { BackgroundFX } from './components/BackgroundFX';
import { MusicPlayerBar } from './components/MusicPlayerBar';
import { SidebarNavigation } from './components/SidebarNavigation';
import { HeroUpload } from './components/HeroUpload';
import { QualityScoreGauge } from './components/QualityScoreGauge';
import { SmartRecommendation } from './components/SmartRecommendation';
import { OptimizationPanel } from './components/OptimizationPanel';
import { ProcessingProgress } from './components/ProcessingProgress';
import { ComparisonViewer } from './components/ComparisonViewer';
import { QualityInspector } from './components/QualityInspector';
import { WarningCard } from './components/WarningCard';

// Media Toolkit Modules
import { MediaHubView } from './components/MediaHubView';
import { VideoToMusicView } from './components/VideoToMusicView';
import { PlatformMediaView } from './components/PlatformMediaView';
import { AudioEditorView } from './components/AudioEditorView';
import { WatermarkEditorView } from './components/WatermarkEditorView';
import { OutroEditorView } from './components/OutroEditorView';
import { DownloadManagerView } from './components/DownloadManagerView';
import { BlenderView } from './components/BlenderView';
import { MediaSettingsModal } from './components/MediaSettingsModal';

import {
  analyzeVideoFile,
  generateDemoVideo,
  createOptimizationJob,
  subscribeJobProgress,
  cancelJob,
  fetchHardwareInfo,
  sendMediaToOptimizer,
  fetchMediaJobs,
  startMediaDownload,
} from './services/api';
import type {
  OptimizationReport,
  JobProgress,
  JobConfig,
  HardwareInfo,
  AppNavSection,
  MediaFormatOption,
} from './types';
import './App.css';

type AppView = 'IDLE' | 'ANALYZING' | 'WORKSPACE' | 'PROCESSING' | 'RESULT';

function App() {
  // Navigation & Tool State
  const [activeSection, setActiveSection] = useState<AppNavSection>('studio-optimize');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeJobsCount, setActiveJobsCount] = useState(0);

  // Cross-tool media bridging state
  const [crossMediaVideoPath, setCrossMediaVideoPath] = useState<string | null>(null);
  const [crossMediaVideoName, setCrossMediaVideoName] = useState<string>('');
  const [crossMediaVideoArtist, setCrossMediaVideoArtist] = useState<string>('');
  const [crossMediaAudioPath, setCrossMediaAudioPath] = useState<string | null>(null);
  const [crossMediaAudioName, setCrossMediaAudioName] = useState<string>('');

  // Video Optimizer Studio State (Original Optimizer)
  const [view, setView] = useState<AppView>('IDLE');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [report, setReport] = useState<OptimizationReport | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [tempPath, setTempPath] = useState<string | null>(null);
  const [originalName, setOriginalName] = useState('');
  const [config, setConfig] = useState<Partial<JobConfig>>({
    mode: 'smart',
    scenario: 'realistic',
    preset: 'tiktok',
    targetResolution: 'original',
    targetFps: 60,
    aspectRatioStrategy: 'blur_background',
    detail: 'natural',
    denoise: 'low',
    deblocking: true,
    debanding: false,
    motion: '60fps',
    color: 'natural',
    audio: 'optimized',
    loudnessNormalization: true,
  });
  const [activeTab, setActiveTab] = useState<'optimize' | 'compare' | 'inspect'>('optimize');
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetchHardwareInfo().then(setHardware).catch(console.error);

    // Periodically update active download count for sidebar badge
    const checkActiveJobs = () => {
      fetchMediaJobs()
        .then((jobs) => {
          const active = jobs.filter(
            (j) => j.progress.status === 'DOWNLOADING' || j.progress.status === 'CONVERTING'
          );
          setActiveJobsCount(active.length);
        })
        .catch(() => {});
    };

    checkActiveJobs();
    const interval = setInterval(checkActiveJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  // Handlers for Video Optimizer
  const handleFileSelect = async (file: File) => {
    setView('ANALYZING');
    setOriginalName(file.name);
    try {
      const data = await analyzeVideoFile(file, (p) => setUploadProgress(p));
      setReport(data.report);
      setTempPath(data.tempPath);
      setView('WORKSPACE');
      setActiveTab('optimize');
    } catch (err: any) {
      alert(`Analysis failed: ${err.message}`);
      setView('IDLE');
    } finally {
      setUploadProgress(0);
    }
  };

  const handleLoadDemo = async () => {
    setView('ANALYZING');
    try {
      const data = await generateDemoVideo();
      setReport(data.report);
      setTempPath(data.tempPath);
      setOriginalName(data.originalName);
      setView('WORKSPACE');
      setActiveTab('optimize');
    } catch (err: any) {
      alert(`Demo generation failed: ${err.message}`);
      setView('IDLE');
    }
  };

  const handleConfigChange = useCallback((partial: Partial<JobConfig>) => {
    setConfig((c) => ({ ...c, ...partial }));
  }, []);

  const startOptimization = async (isPreview = false) => {
    if (!tempPath) return;
    try {
      const { jobId } = await createOptimizationJob({
        tempPath,
        originalName,
        config: { ...config, isPreview, previewDuration: 5 },
      });
      setCurrentJobId(jobId);
      setView('PROCESSING');

      const unsubscribe = subscribeJobProgress(
        jobId,
        (progress) => {
          setJobProgress(progress);
          if (progress.state === 'COMPLETED') {
            setView('RESULT');
            unsubscribe();
          } else if (progress.state === 'FAILED' || progress.state === 'CANCELLED') {
            unsubscribe();
          }
        },
        (err) => {
          console.error('SSE Error:', err);
          unsubscribe();
        }
      );
    } catch (err: any) {
      alert(`Failed to start optimization: ${err.message}`);
    }
  };

  const handleCancel = async () => {
    if (currentJobId) {
      await cancelJob(currentJobId);
      setCurrentJobId(null);
      setJobProgress(null);
      setView('IDLE');
    }
  };

  const handleReset = () => {
    setView('IDLE');
    setReport(null);
    setJobProgress(null);
    setCurrentJobId(null);
    setTempPath(null);
    setConfig({});
    setActiveTab('optimize');
    setActiveSection('studio-optimize');
  };

  // Cross-Tool Navigation Bridges
  const handleSendToOptimizer = async (filePath: string, name: string) => {
    try {
      const data = await sendMediaToOptimizer(filePath, name);
      setReport(data.report);
      setTempPath(data.tempPath);
      setOriginalName(data.originalName);
      setActiveSection('studio-optimize');
      setView('WORKSPACE');
      setActiveTab('optimize');
    } catch (err: any) {
      alert(`Handoff to Video Optimizer failed: ${err.message}`);
    }
  };

  const handleSendToAudio = (filePath: string, name: string, artist?: string) => {
    setCrossMediaVideoPath(filePath);
    setCrossMediaVideoName(name);
    setCrossMediaVideoArtist(artist || '');
    setActiveSection('media-video-to-music');
  };

  const handleDirectDownload = async (format: MediaFormatOption) => {
    try {
      const directUrl = format.directDownloadUrl;
      if (!directUrl) {
        alert('No downloadable URL is available for this format.');
        return;
      }
      await startMediaDownload({
        sourceUrl: directUrl,
        directUrl: directUrl,
        title: format.qualityLabel,
        type: format.type,
        format: format.format,
        customBitrate: format.bitrateKbps,
      });
      setActiveSection('media-downloads');
    } catch (err: any) {
      alert(err.message || 'Failed to start download');
    }
  };

  const handleSendToAudioEditor = (audioPath: string, name: string) => {
    setCrossMediaAudioPath(audioPath);
    setCrossMediaAudioName(name);
    setActiveSection('media-audio-converter');
  };

  const isProcessing = view === 'PROCESSING';
  const meta = report?.metadata;

  return (
    <div className="min-h-screen flex flex-col bg-black text-neutral-100 selection:bg-white/30">
      <BackgroundFX />
      <MusicPlayerBar />
      {/* Main App Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navbar */}
        <Navbar
          hardware={hardware}
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onOpenHardware={() => setIsSettingsOpen(true)}
          onOpenPhilosophy={() => setIsSettingsOpen(true)}
          onReset={handleReset}
          hasActiveVideo={!!report}
        />

        {/* Horizontal Section Navigation */}
        <SidebarNavigation
          activeSection={activeSection}
          onSelectSection={(sec) => {
            if (sec === 'settings') {
              setIsSettingsOpen(true);
            } else {
              setActiveSection(sec);
            }
          }}
          isOpenMobile={isSidebarOpen}
          onToggleMobile={() => setIsSidebarOpen((prev) => !prev)}
          activeJobsCount={activeJobsCount}
        />

        <main className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {/* VIEW: STUDIO VIDEO OPTIMIZER */}
          {activeSection === 'studio-optimize' && (
            <div className="flex-1 flex flex-col">
              {view === 'IDLE' && (
                <HeroUpload
                  onFileSelect={handleFileSelect}
                  onLoadDemo={handleLoadDemo}
                  isAnalyzing={false}
                  isGeneratingDemo={false}
                  uploadProgress={0}
                />
              )}

              {view === 'ANALYZING' && (
                <HeroUpload
                  onFileSelect={() => {}}
                  onLoadDemo={() => {}}
                  isAnalyzing={uploadProgress < 100}
                  isGeneratingDemo={uploadProgress === 100}
                  uploadProgress={uploadProgress}
                />
              )}

              {view === 'WORKSPACE' && report && (
                <div className="studio-container py-4 space-y-6">
                  <div className="text-center mb-6">
                    <h2 className="text-2xl sm:text-3xl font-bold text-violet-300 mb-2">
                      Optimization Workspace
                    </h2>
                    <p className="text-sm text-neutral-400">
                      {meta?.width}×{meta?.height} • {meta?.fps} FPS • {meta?.codec} •{' '}
                      {(report.metadata.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  </div>

                  {/* Tabs */}
                  <div className="flex justify-center gap-1 mb-6 bg-white/5 p-1 rounded-xl border border-white/5 w-fit mx-auto">
                    {(['optimize', 'compare', 'inspect'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${
                          activeTab === tab
                            ? 'bg-white/20 text-white shadow-glow-white/10'
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        {tab === 'optimize' ? 'Optimize' : tab === 'compare' ? 'Compare' : 'Inspect'}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left: Main content */}
                    <div className="lg:col-span-8 space-y-6">
                      {activeTab === 'optimize' && (
                        <>
                          <SmartRecommendation
                            report={report}
                            onApply={() => handleConfigChange({ mode: 'smart', preset: 'tiktok' })}
                            onCustomize={() => {
                              setActiveTab('optimize');
                              setTimeout(() => {
                                document
                                  .getElementById('optimization-settings')
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }, 50);
                            }}
                          />
                          <div id="optimization-settings">
                            <OptimizationPanel
                              config={config as JobConfig}
                              onChange={handleConfigChange}
                              onStartOptimization={() => startOptimization(false)}
                              onPreview={() => startOptimization(true)}
                              isProcessing={isProcessing}
                              warnings={report.recommendations.details}
                            />
                          </div>
                        </>
                      )}

                      {activeTab === 'compare' && tempPath && (
                        <div className="glass-panel p-5 rounded-2xl border border-white/[0.08]">
                          <ComparisonViewer
                            srcOriginal={`/api/jobs/${currentJobId || 'preview'}/source`}
                            srcOptimized={`/api/jobs/${currentJobId || 'preview'}/output`}
                          />
                        </div>
                      )}

                      {activeTab === 'inspect' && (
                        <QualityInspector
                          metadata={meta}
                          validation={jobProgress?.validationReport}
                          outputSize={jobProgress?.outputSize}
                        />
                      )}
                    </div>

                    {/* Right: Sidebar */}
                    <div className="lg:col-span-4 space-y-6">
                      <QualityScoreGauge score={report.qualityScore} />
                      <WarningCard
                        level="info"
                        title="Privacy Notice"
                        message="Your video is processed temporarily and is not stored permanently. No login is required."
                      />
                      {report.detectedProblems
                        .filter((p) => !p.includes('pristine') && !p.includes('High fidelity'))
                        .slice(0, 3)
                        .map((problem, i) => (
                          <WarningCard
                            key={i}
                            level="warning"
                            title="Detected Issue"
                            message={problem}
                          />
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {view === 'PROCESSING' && jobProgress && (
                <div className="studio-container py-24">
                  <ProcessingProgress progress={jobProgress} onCancel={handleCancel} />
                </div>
              )}

              {view === 'RESULT' && jobProgress && report && (
                <div className="studio-container py-8 sm:py-12 space-y-6">
                  <div className="text-center space-y-3">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-sm font-bold uppercase tracking-widest">
                        Optimization Complete
                      </span>
                    </div>
                    <h2 className="text-3xl sm:text-4xl font-extrabold text-emerald-300">
                      Your video is ready.
                    </h2>
                    <p className="text-sm text-neutral-400">
                      Preview the result, inspect quality, then download or start a new job.
                    </p>
                  </div>

                  {/* Result Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-8 space-y-4">
                      <div className="glass-panel rounded-2xl border border-white/[0.08] overflow-hidden">
                        <div className="p-4 border-b border-white/5 flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-300">
                              Optimized Preview
                            </h3>
                            <p className="text-[11px] text-neutral-500 mt-0.5 font-mono">
                              {report.metadata.width}×{report.metadata.height} →{' '}
                              {jobProgress.validationReport?.outputResolution || '...'} •{' '}
                              {report.metadata.fps} FPS →{' '}
                              {jobProgress.validationReport?.outputFps || '...'} FPS
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                const video = previewVideoRef.current;
                                if (!video) return;
                                video.paused ? video.play() : video.pause();
                              }}
                              className="px-4 py-2 rounded-xl bg-white/20 border border-white/30 text-white text-xs font-semibold hover:bg-white/30 transition-all flex items-center gap-2"
                            >
                              <Play className="w-3.5 h-3.5" />
                              {previewVideoRef.current?.paused ? 'Play' : 'Pause'}
                            </button>
                            <a
                              href={jobProgress.outputUrl}
                              download
                              className="px-4 py-2 rounded-xl bg-white hover:bg-neutral-200 text-black text-xs font-bold transition-all shadow-lg shadow-white/20"
                            >
                              Download
                            </a>
                          </div>
                        </div>
                        <div className="relative w-full aspect-video bg-black">
                          <video
                            ref={previewVideoRef}
                            src={`/api/jobs/${currentJobId}/output`}
                            className="w-full h-full object-contain"
                            controls
                            playsInline
                          />
                        </div>
                      </div>

                      {/* Before / After Strip */}
                      <div className="glass-panel p-4 rounded-2xl border border-white/[0.08]">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">
                          Before / After Compare
                        </h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-white/10">
                              <video
                                src={`/api/jobs/${currentJobId}/source`}
                                className="w-full h-full object-contain"
                                controls
                                playsInline
                              />
                            </div>
                            <p className="text-[10px] text-neutral-500 text-center uppercase tracking-wider">
                              Original Source
                            </p>
                          </div>
                          <div className="space-y-2">
                            <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-white/20">
                              <video
                                src={`/api/jobs/${currentJobId}/output`}
                                className="w-full h-full object-contain"
                                controls
                                playsInline
                              />
                            </div>
                            <p className="text-[10px] text-white text-center uppercase tracking-wider font-semibold">
                              Optimized Output
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right Summary */}
                    <div className="lg:col-span-4 space-y-4">
                      <div className="glass-panel p-5 rounded-2xl border border-white/[0.08] space-y-3">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-300">
                          Job Summary
                        </h3>
                        <div className="space-y-2">
                          <SummaryRow
                            label="Original"
                            value={`${report.metadata.width}×${report.metadata.height} • ${report.metadata.fps} FPS`}
                          />
                          <SummaryRow
                            label="Output"
                            value={jobProgress.validationReport?.outputResolution || 'Processing...'}
                          />
                          <SummaryRow
                            label="Output FPS"
                            value={String(jobProgress.validationReport?.outputFps || '...')}
                          />
                          <SummaryRow
                            label="Duration"
                            value={`${jobProgress.validationReport?.outputDuration || report.metadata.duration}s`}
                          />
                          <SummaryRow
                            label="Audio"
                            value={jobProgress.validationReport?.audioSynced ? 'Synced ✓' : 'Checking...'}
                          />
                          <SummaryRow
                            label="File Size"
                            value={`${(jobProgress.outputSize ? jobProgress.outputSize / (1024 * 1024) : 0).toFixed(1)} MB`}
                          />
                        </div>
                      </div>

                      {/* Ecosystem Handoff Buttons */}
                      <div className="glass-panel p-5 rounded-2xl border border-white/[0.08] space-y-3">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                          Next Actions
                        </h3>
                        <a
                          href={jobProgress.outputUrl}
                          download
                          className="w-full py-3.5 rounded-xl bg-white hover:bg-neutral-200 text-black font-bold text-sm transition-all shadow-lg shadow-white/20 flex items-center justify-center gap-2"
                        >
                          <Download className="w-4 h-4" />
                          Download Optimized Video
                        </a>

                        <button
                          onClick={() =>
                            handleSendToAudio(
                              `storage/jobs/${currentJobId}/optimized_${currentJobId}.mp4`,
                              originalName
                            )
                          }
                          className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 transition-all flex items-center justify-center gap-2"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-neutral-300" />
                          Extract Audio from this Video
                        </button>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setView('WORKSPACE')}
                            className="py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 text-xs"
                          >
                            Change Settings
                          </button>
                          <button
                            onClick={handleReset}
                            className="py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 text-xs"
                          >
                            New Video
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW: MEDIA TOOLS OVERVIEW HUB */}
          {activeSection === 'media-hub' && <MediaHubView onNavigate={setActiveSection} />}

           {/* VIEW: VIDEO TO MUSIC */}
           {activeSection === 'media-video-to-music' && (
             <VideoToMusicView
               initialVideoPath={crossMediaVideoPath || undefined}
               initialVideoName={crossMediaVideoName || undefined}
               initialVideoArtist={crossMediaVideoArtist || undefined}
               onSendToAudioEditor={handleSendToAudioEditor}
             />
           )}

          {/* VIEW: PLATFORM DOWNLOADERS (YouTube, SoundCloud, Pinterest, TikTok, Images, Videos)
              All providers stay mounted (hidden when inactive) so their inputs,
              analysis results, and track selections are preserved on switch. */}
          {(
            [
              'media-youtube',
              'media-soundcloud',
              'media-pinterest',
              'media-tiktok',
              'media-images',
              'media-videos',
            ] as const
          ).map((sec) => (
            <div key={sec} className={activeSection === sec ? '' : 'hidden'}>
              <PlatformMediaView
                section={sec}
                onSendToOptimizer={handleSendToOptimizer}
                onDirectDownload={handleDirectDownload}
                onJobStarted={() => setActiveSection('media-downloads')}
              />
            </div>
          ))}

          {/* VIEW: PRO AUDIO CONVERTER & EDITOR */}
          {activeSection === 'media-audio-converter' && (
            <AudioEditorView
              initialAudioPath={crossMediaAudioPath || undefined}
              initialAudioName={crossMediaAudioName || undefined}
            />
          )}

          {/* VIEW: WATERMARK EDITOR */}
          {activeSection === 'media-watermark' && (
            <WatermarkEditorView
              initialVideoPath={crossMediaVideoPath || undefined}
              initialVideoName={crossMediaVideoName || undefined}
              onSendToOptimizer={handleSendToOptimizer}
            />
          )}

          {/* VIEW: OUTRO TRIMMER */}
          {activeSection === 'media-outro' && (
            <OutroEditorView
              initialVideoPath={crossMediaVideoPath || undefined}
              initialVideoName={crossMediaVideoName || undefined}
              onSendToOptimizer={handleSendToOptimizer}
            />
          )}

          {/* VIEW: BLENDER 3D STUDIO */}
          {activeSection === 'blender-3d' && <BlenderView />}

          {/* VIEW: DOWNLOAD MANAGER */}
          {activeSection === 'media-downloads' && (
            <DownloadManagerView onSendToOptimizer={handleSendToOptimizer} />
          )}
        </main>
      </div>

      <footer className="border-t border-white/[0.05] py-6 text-center text-xs text-neutral-500">
        <p>
          &copy; 2026 <span className="text-neutral-400 font-medium">VideoOptimize</span> &mdash; AI Video Optimizer + Media Toolkit.
        </p>
      </footer>

      {/* Global Settings & Hardware Modal */}
      <MediaSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        hardware={hardware}
      />
    </div>
  );
}

const SummaryRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
    <span className="text-[11px] text-neutral-500 uppercase tracking-wider">{label}</span>
    <span className="text-xs font-mono text-neutral-200">{value}</span>
  </div>
);

export default App;
