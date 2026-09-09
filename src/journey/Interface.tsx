/**
 * The interface — everything the observer sees that is not the universe itself.
 *
 * It is three things and nothing else: the ayah, a readout of where and when the
 * vehicle actually is, and one transparent surface that reads taps and swipes.
 * There is no transport, no menu, no picker, no settings, and no button that is
 * not an isnaad orientation.
 *
 * THE GESTURE CONTRACT
 * --------------------
 *   swipe  →  move the focus between the orientations this ayah offers
 *   tap    →  adopt the focused orientation (or release it, if already adopted)
 *
 * That is the whole input surface. A swipe is any drag past the threshold in any
 * direction — the fan of markers is arranged in an arc, so a diagonal drag is a
 * legitimate way to reach the next one and refusing it would feel broken.
 *
 * The first tap of a session does one extra thing: it opens the AudioContext.
 * Browsers will not start audio without a gesture, and rather than dress that
 * requirement up as a splash screen with a button, it is folded into the same
 * tap that would have adopted an orientation.
 */

import { useEffect, useRef, useState } from 'react';

import { useSession, activePhenomenon } from '@/state/store';
import { peekAyahText } from '@/services/QuranTextService';
import { getSurah, toArabicNumerals } from '@/data/surahs';
import { PHENOMENON_BY_ID } from '@/data/phenomena';
import { formatSolarTime, julianDay, localSolarTime, moonPhase, solarAltitude } from '@/astro/ephemeris';
import { bearingName, formatGeo, qiblaBearing } from '@/astro/geo';
import { orientationsFor } from './orientations';
import { shellOf } from './waypoints';

/** Past this many pixels a pointer movement is a swipe and not a tap. */
const SWIPE_THRESHOLD = 34;

export function GestureSurface() {
  const unlocked = useSession((state) => state.unlocked);
  const unlock = useSession((state) => state.unlock);
  const focus = useSession((state) => state.focus);
  const commitFocus = useSession((state) => state.commitFocus);

  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  return (
    <div
      className="isnaad-gesture"
      onPointerDown={(event) => {
        start.current = { x: event.clientX, y: event.clientY, t: performance.now() };
      }}
      onPointerUp={(event) => {
        const origin = start.current;
        start.current = null;
        if (!origin) return;

        const dx = event.clientX - origin.x;
        const dy = event.clientY - origin.y;
        const travelled = Math.hypot(dx, dy);

        if (!unlocked) {
          // The one unavoidable gesture. It is a tap or a swipe; either opens
          // the audio graph, because refusing a swipe here would leave the
          // observer tapping at a universe that never starts.
          unlock();
          return;
        }

        if (travelled >= SWIPE_THRESHOLD) {
          // The dominant axis decides direction. In an RTL interface a leftward
          // drag advances, matching the reading order the rest of the app uses.
          const horizontal = Math.abs(dx) >= Math.abs(dy);
          const forward = horizontal ? dx < 0 : dy < 0;
          focus(forward ? 1 : -1);
        } else {
          commitFocus();
        }
      }}
      onPointerCancel={() => { start.current = null; }}
    />
  );
}

/** The ayah itself, in the Uthmani script, over the field. */
function Veil() {
  const surah = useSession((state) => state.surah);
  const ayah = useSession((state) => state.ayah);
  const veil = useSession((state) => state.veil);
  const textLoading = useSession((state) => state.textLoading);
  const textError = useSession((state) => state.textError);
  const routeFailed = useSession((state) => state.routeFailed);
  const unlocked = useSession((state) => state.unlocked);

  // `peekAyahText` reads a cache the service fills asynchronously, so the value
  // has to be re-read when the load settles rather than only when the verse
  // changes — otherwise the first ayah of every surah renders blank.
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(peekAyahText(surah, ayah)?.text ?? null);
  }, [surah, ayah, textLoading]);

  if (!veil) return null;

  return (
    <div className="isnaad-veil" aria-live="polite">
      {!unlocked && (
        <p className="isnaad-veil__gate">المس لتبدأ السير</p>
      )}
      <p className="isnaad-veil__ayah">{text ?? (textLoading ? '…' : '')}</p>
      <p className="isnaad-veil__key">
        {getSurah(surah).name} · {toArabicNumerals(ayah)}
      </p>
      {textError && <p className="isnaad-veil__fault">{textError}</p>}
      {routeFailed && <p className="isnaad-veil__fault">تعذّر المسار الصوتي — يُستأنف السير</p>}
    </div>
  );
}

/**
 * الموضع — where and when the vehicle is, right now.
 *
 * Every line is measured: the coordinate is the waypoint being flown to, the
 * solar time is the true local solar time at that longitude, the qibla bearing
 * is the great-circle bearing to the Kaaba from there, and the sun's altitude is
 * what decides whether that point is in daylight at this instant.
 */
function Readout() {
  const waypoint = useSession((state) => state.waypoint);
  const phenomenon = useSession((state) => activePhenomenon(state));
  const provider = useSession((state) => state.provider);

  // Half a second. The quantities change slowly and this is a text layer on top
  // of a WebGL canvas that wants every millisecond it can get.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, []);

  const jd = julianDay();
  const altitude = solarAltitude(jd, waypoint.at);
  const moon = moonPhase(jd);

  return (
    <div className="isnaad-readout">
      <div className="isnaad-readout__row">
        <span className="isnaad-readout__label">الموضع</span>
        <span>{formatGeo(waypoint.at)}</span>
      </div>
      <div className="isnaad-readout__row">
        <span className="isnaad-readout__label">الزمن الشمسي</span>
        <span>
          {formatSolarTime(localSolarTime(jd, waypoint.at.lon))}
          {' · '}
          {altitude > 0 ? 'نهار' : altitude > -6 ? 'شفق' : 'ليل'}
        </span>
      </div>
      <div className="isnaad-readout__row">
        <span className="isnaad-readout__label">القبلة</span>
        <span>
          {bearingName(qiblaBearing(waypoint.at))}
          {' · '}
          {toArabicNumerals(Math.round(qiblaBearing(waypoint.at)))}°
        </span>
      </div>
      <div className="isnaad-readout__row">
        <span className="isnaad-readout__label">القمر</span>
        <span>
          {toArabicNumerals(Math.round(moon.illumination * 100))}٪
          {' · '}
          {moon.waxing ? 'متزايد' : 'متناقص'}
        </span>
      </div>
      <div className="isnaad-readout__row isnaad-readout__row--wide">
        <span className="isnaad-readout__label">المحطة</span>
        <span>
          {PHENOMENON_BY_ID[phenomenon].title}
          {waypoint.anchored ? ' ⟡' : ''}
        </span>
      </div>
      <div className="isnaad-readout__row">
        <span className="isnaad-readout__label">الغلاف</span>
        <span>{toArabicNumerals(shellOf(waypoint.index))}</span>
      </div>
      {provider && (
        <div className="isnaad-readout__row isnaad-readout__row--wide">
          <span className="isnaad-readout__label">المصدر</span>
          <span>{provider}</span>
        </div>
      )}
    </div>
  );
}

/**
 * A hint of what a swipe would reach next — the offered orientations as a row of
 * sigils, with the focused one marked. It is not a control: it has no pointer
 * events. The controls are the markers standing in the world.
 */
function OrientationTrail() {
  const phenomenon = useSession((state) => activePhenomenon(state));
  const playing = useSession((state) => state.playing);
  const focused = useSession((state) => state.focused);
  const adopted = useSession((state) => state.orientation);

  const offered = orientationsFor(phenomenon, playing);
  if (offered.length === 0) return null;

  return (
    <div className="isnaad-trail">
      {offered.map((orientation) => (
        <span
          key={orientation.id}
          className={[
            'isnaad-trail__dot',
            adopted === orientation.id ? 'is-adopted' : '',
            focused === orientation.id ? 'is-focused' : '',
          ].join(' ')}
        >
          {orientation.sigil}
        </span>
      ))}
    </div>
  );
}

export function Interface() {
  return (
    <>
      <Readout />
      <Veil />
      <OrientationTrail />
      {/* Last, so it sits above the passive layers — and it is the only one of
          them that accepts pointer events at all. */}
      <GestureSurface />
    </>
  );
}
