/**
 * The main render surface.
 *
 * Layer order inside the canvas:
 *   EngineDriver        — analyses audio and recomputes the Isnaad array (first)
 *   InvertedViewport    — الرتق: the crystal boundary the observer looks into
 *     └ active scene    — one of the twenty phenomena
 *   DefensiveAxis       — دار القرار: the stabilising matrix
 *   StarTreeRopes       — حبالهم: sky ↔ terrestrial tethers
 */

import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, AdaptiveDpr } from '@react-three/drei';
import * as THREE from 'three';

import { EngineDriver, CORE_RADIUS } from '@/engine/EngineDriver';
import { InvertedViewport } from '@/engine/spatial/InvertedViewport';
import { StarTreeRopes } from '@/engine/spatial/StarTreeRopes';
import { DefensiveAxis } from '@/engine/spatial/DefensiveAxis';
import { EXPERIENCE_SCENES } from '@/experiences';
import { PHENOMENON_BY_ID, type PhenomenonId } from '@/data/phenomena';

export interface ViewportProps {
  phenomenon: PhenomenonId;
  inverted: boolean;
  /** Spatial overlays (ropes + defensive axis) can be muted for a bare scene study. */
  overlays?: boolean;
}

export function Viewport({ phenomenon, inverted, overlays = true }: ViewportProps) {
  const definition = PHENOMENON_BY_ID[phenomenon];
  const Scene = EXPERIENCE_SCENES[phenomenon];

  // Scenes author themselves at roughly unit scale; inside the crystal they are
  // shrunk so the whole phenomenon is contained by the boundary.
  const sceneScale = inverted ? 0.62 : 1;

  const fog = useMemo(() => new THREE.FogExp2('#030712', 0.045), []);

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      // Slightly above the equator so the phenomenon sits centred, not low in frame.
      camera={{ position: [0, 0.9, inverted ? 9.2 : 6.4], fov: 55, near: 0.1, far: 100 }}
    >
      <color attach="background" args={['#030712']} />
      <primitive attach="fog" object={fog} />

      <EngineDriver />

      <Suspense fallback={null}>
        {inverted ? (
          <InvertedViewport accent={definition.accent} radius={CORE_RADIUS}>
            <group scale={sceneScale}>
              <Scene accent={definition.accent} />
            </group>
          </InvertedViewport>
        ) : (
          <group scale={sceneScale}>
            <Scene accent={definition.accent} />
          </group>
        )}

        {overlays && (
          <>
            <DefensiveAxis accent={definition.accent} radius={CORE_RADIUS * 0.78} />
            <StarTreeRopes accent={definition.accent} radius={CORE_RADIUS * 1.55} />
          </>
        )}
      </Suspense>

      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.06}
        rotateSpeed={0.45}
        zoomSpeed={0.6}
        // The observer is stationed OUTSIDE the crystal and may not enter it.
        minDistance={inverted ? CORE_RADIUS * 1.35 : 2.4}
        maxDistance={inverted ? CORE_RADIUS * 4.2 : 14}
      />

      <AdaptiveDpr pixelated />
    </Canvas>
  );
}
