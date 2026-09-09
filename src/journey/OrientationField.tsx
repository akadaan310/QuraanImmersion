/**
 * The orientation markers — the only thing in the universe that answers a touch.
 *
 * They stand in space around the station, arranged by the standpoint each one
 * represents: the terrestrial witness low against the globe, the unseen listener
 * high and behind, the closure highest of all. Their arrangement is the vector
 * array made visible, so choosing one by where it stands is the same act as
 * choosing it by what it means.
 *
 * WHY THEIR PLACEMENT IS A SCREEN-SPACE PROBLEM
 * ---------------------------------------------
 * The obvious placement — a fan in the station's own east–north–up frame — puts
 * markers wherever that frame happens to point, and the camera is flying. Half
 * of them ended up behind the observer or outside the frustum: present in the
 * DOM, invisible on screen, and therefore untappable. In an application whose
 * entire input surface is these four buttons, that is not a cosmetic bug.
 *
 * Choosing a world-space radius instead does not fix it either, because whether
 * that radius lands on screen depends on the camera's distance, its field of
 * view and the viewport's aspect together — and all three change continuously
 * through a flight and again with every orientation adopted.
 *
 * So the ring is specified where the constraint actually lives: as a fraction of
 * the viewport, unprojected onto a plane in front of the station. The markers
 * remain real objects at a real depth, scaling and occluding correctly, but
 * their screen position is now the input rather than the outcome, and they
 * cannot leave the viewport at any distance, field of view or aspect ratio.
 * What each orientation's own elevation still decides is WHERE on that ring it
 * sits — high for the unseen and the closure, low for the witness — so the
 * meaning of the arrangement survives.
 *
 * They are DOM elements positioned in 3D (drei's `Html`) rather than meshed
 * text. Two reasons, both practical: Arabic needs contextual shaping and
 * bidirectional layout, which the browser does correctly and a glyph atlas in a
 * texture does not; and a DOM node is a real touch target with the platform's
 * own hit-slop.
 */

import { useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { Orientation, OrientationId } from './orientations';

const DEG = Math.PI / 180;

interface FieldProps {
  /** World position of the station these orientations belong to. */
  station: THREE.Vector3;
  offered: Orientation[];
  adopted: OrientationId | null;
  focused: OrientationId | null;
  visible: boolean;
  onAdopt: (id: OrientationId) => void;
}

export function OrientationField({
  station, offered, adopted, focused, visible, onAdopt,
}: FieldProps) {
  const camera = useThree((state) => state.camera);
  const groups = useRef<(THREE.Group | null)[]>([]);

  const scratch = useMemo(() => ({ projected: new THREE.Vector3() }), []);

  /**
   * Where each marker sits on the ring, as an angle from straight up in screen
   * space.
   *
   * Mapping elevation directly onto the angle is the obvious approach and it
   * collides: إسناد الصوت stands at 0° elevation and الشاهد الأرضي at −6°, so
   * the two land six degrees apart on the ring and their labels overlap into an
   * unreadable stack. Instead the orientations are RANKED by elevation and the
   * ranks are dealt alternately outward from the top. The meaning is preserved —
   * the highest standpoint is highest on the ring — and the separation is now a
   * property of the construction rather than a hope about the input.
   */
  const angles = useMemo(() => {
    const byElevation = offered
      .map((orientation, index) => ({ index, elevation: orientation.elevation }))
      // Ties broken by the offered order, so the arrangement is deterministic.
      .sort((a, b) => (b.elevation - a.elevation) || (a.index - b.index));

    const placed = new Array<number>(offered.length).fill(0);
    byElevation.forEach((entry, rank) => {
      // ±38°, ±92°, ±146° … : never closer than 54° apart, on either side.
      const magnitude = (38 + Math.floor(rank / 2) * 54) * DEG;
      placed[entry.index] = rank % 2 === 0 ? magnitude : -magnitude;
    });
    return placed;
  }, [offered]);

  useFrame(() => {
    if (!visible) return;

    // Where the station itself lands on screen. Deriving the ring's centre from
    // the projection rather than assuming screen centre keeps the markers around
    // the station during the approach, when the camera is still turning onto it.
    scratch.projected.copy(station).project(camera);
    // Behind the camera, `project` mirrors the point through the origin. Clamping
    // the centre is what stops the markers flying to the far corners for the one
    // or two frames a hard turn puts the station behind the observer.
    const centreX = THREE.MathUtils.clamp(scratch.projected.x, -0.35, 0.35);
    const centreY = THREE.MathUtils.clamp(scratch.projected.y, -0.35, 0.35);
    // Pull the ring a little in front of the station in depth, so a marker is
    // never occluded by the very scene it offers a standpoint on. NDC z is
    // non-linear; a small constant here is a large distance near the camera and
    // a small one far away, which is the behaviour wanted.
    const depth = THREE.MathUtils.clamp(scratch.projected.z - 0.004, -0.999, 0.999);

    groups.current.forEach((group, index) => {
      if (!group) return;
      const angle = angles[index] ?? 0;

      // The ring, in normalised device coordinates — the one space where "on
      // screen" is a fixed condition rather than a function of fov and aspect.
      // Radii are chosen so the ring plus a marker's own half-size stays inside
      // ±1 on the narrowest viewport the app is used on.
      const x = THREE.MathUtils.clamp(centreX + Math.sin(angle) * 0.46, -0.68, 0.68);
      const y = THREE.MathUtils.clamp(centreY + Math.cos(angle) * 0.50, -0.66, 0.66);

      // Unproject through the camera's actual matrices. Computing the frustum
      // half-extents by hand was the previous approach and it was wrong whenever
      // `camera.aspect` had not yet caught up with a resize — markers left the
      // screen on exactly the viewport that had just changed.
      group.position.set(x, y, depth).unproject(camera);
    });
  });

  if (!visible || offered.length === 0) return null;

  return (
    <>
      {offered.map((orientation, index) => {
        const isAdopted = adopted === orientation.id;
        const isFocused = focused === orientation.id;
        return (
          <group key={orientation.id} ref={(node) => { groups.current[index] = node; }}>
            <Html
              center
              // Scaling with distance keeps the markers part of the scene rather
              // than an overlay pasted on top of it.
              distanceFactor={1.9}
              zIndexRange={[40, 20]}
              style={{ pointerEvents: 'auto' }}
            >
              <button
                type="button"
                className={[
                  'isnaad-orientation',
                  isAdopted ? 'is-adopted' : '',
                  isFocused ? 'is-focused' : '',
                ].join(' ')}
                onPointerDown={(event) => {
                  // Stop the gesture surface beneath from also reading this as a
                  // tap on empty space, which would commit the focus a second
                  // time and undo the choice just made.
                  event.stopPropagation();
                  onAdopt(orientation.id);
                }}
                aria-label={orientation.name}
              >
                <span className="isnaad-orientation__sigil">{orientation.sigil}</span>
                <span className="isnaad-orientation__name">{orientation.name}</span>
              </button>
            </Html>
          </group>
        );
      })}
    </>
  );
}
