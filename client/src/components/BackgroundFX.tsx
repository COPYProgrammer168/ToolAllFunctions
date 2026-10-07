import React from 'react';

/**
 * Global animated 2027-style background:
 * blurred drifting orbs + 3D perspective grid + rotating wireframe ring.
 */
export const BackgroundFX: React.FC = () => (
  <div className="bg-scene" aria-hidden="true">
    <div
      className="bg-orb"
      style={{
        width: 560, height: 560, top: '-10%', left: '-10%',
        background: 'radial-gradient(circle, rgba(255,255,255,0.55), transparent 70%)',
        animation: 'orbDrift1 22s ease-in-out infinite',
      }}
    />
    <div
      className="bg-orb"
      style={{
        width: 640, height: 640, bottom: '-15%', right: '-10%',
        background: 'radial-gradient(circle, rgba(255,255,255,0.4), transparent 70%)',
        animation: 'orbDrift2 28s ease-in-out infinite',
      }}
    />
    <div
      className="bg-orb"
      style={{
        width: 420, height: 420, top: '30%', left: '55%',
        background: 'radial-gradient(circle, rgba(255,255,255,0.35), transparent 70%)',
        animation: 'orbDrift3 18s ease-in-out infinite',
      }}
    />
    <div className="bg-grid-3d" />
    <div className="bg-ring-3d" />
    <div className="bg-vignette" />
  </div>
);

