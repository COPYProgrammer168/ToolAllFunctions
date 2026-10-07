import React, { useState } from 'react';
import { Box, Play, Copy, Download, CheckCircle } from 'lucide-react';

/**
 * Blender 3D Studio — generates Blender Python scripts and launches a lightweight
 * Blender workflow from inside VideoOptimize.
 */
export const BlenderView: React.FC = () => {
  const [sceneName, setSceneName] = useState('VideoOptimize_Scene');
  const [renderEngine, setRenderEngine] = useState<'CYCLES' | 'BLENDER_EEVEE_NEXT' | 'BLENDER_WORKBENCH'>('CYCLES');
  const [resolution, setResolution] = useState('1920x1080');
  const [copied, setCopied] = useState(false);

  const script = `# VideoOptimize -> Blender bridge script
import bpy

scene = bpy.context.scene
scene.render.engine = '${renderEngine}'
scene.render.resolution_x = ${resolution.split('x')[0]}
scene.render.resolution_y = ${resolution.split('x')[1]}
scene.render.fps = 60

# Example: primitive blockout
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(3, 0, 1))

scene.name = '${sceneName}'
print('[VideoOptimize] Scene ready:', scene.name)
`;

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const downloadScript = () => {
    const blob = new Blob([script], { type: 'text/python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sceneName}.py`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl sm:text-3xl font-bold text-orange-300">Blender 3D Studio</h2>
        <p className="text-sm text-neutral-400">
          Configure a Blender scene, generate its Python driver script, and pipe it straight into Blender.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Config */}
        <div className="glass-panel p-6 rounded-2xl border border-white/[0.08] space-y-5">
          <div className="flex items-center gap-2">
            <Box className="w-4 h-4 text-white" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-300">Scene Config</h3>
          </div>

          <label className="block space-y-1.5">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">Scene Name</span>
            <input
              value={sceneName}
              onChange={(e) => setSceneName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-white/40"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">Render Engine</span>
            <select
              value={renderEngine}
              onChange={(e) => setRenderEngine(e.target.value as typeof renderEngine)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-white/40"
            >
              <option value="CYCLES">Cycles</option>
              <option value="BLENDER_EEVEE_NEXT">Eevee Next</option>
              <option value="BLENDER_WORKBENCH">Workbench</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">Resolution</span>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-white/40"
            >
              <option value="1280x720">1280 × 720</option>
              <option value="1920x1080">1920 × 1080</option>
              <option value="2560x1440">2560 × 1440</option>
              <option value="3840x2160">3840 × 2160 (4K)</option>
            </select>
          </label>

          <div className="flex gap-2 pt-1">
            <button
              onClick={copyScript}
              className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all"
            >
              {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy Script'}
            </button>
            <button
              onClick={downloadScript}
              className="flex-1 py-3 rounded-xl bg-white text-black text-xs font-bold flex items-center justify-center gap-2 hover:bg-neutral-200 transition-all"
            >
              <Download className="w-4 h-4" />
              Download .py
            </button>
          </div>
        </div>

        {/* Script preview */}
        <div className="glass-panel p-6 rounded-2xl border border-white/[0.08] space-y-4">
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4 text-white" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-300">Generated Driver</h3>
          </div>
          <pre className="text-[11px] leading-relaxed font-mono text-neutral-300 bg-black/60 border border-white/10 rounded-xl p-4 overflow-x-auto whitespace-pre">
            {script}
          </pre>
          <p className="text-[11px] text-neutral-500">
            In Blender: <span className="text-neutral-300 font-mono">Scripting → Open → Run</span> this file, or launch Blender with
            <span className="text-neutral-300 font-mono"> blender --python {sceneName}.py</span>.
          </p>
        </div>
      </div>
    </div>
  );
};


