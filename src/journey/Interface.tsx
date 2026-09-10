/**
 * The interface — everything on screen that is not the universe.
 *
 * Four things: the ayah, a readout of where and when the vehicle actually is, a
 * row of controls along the bottom edge, and the drawer they open.
 *
 * WHAT REPLACED THE ORIENTATION MARKERS
 * -------------------------------------
 * There used to be four buttons floating in the world, one per isnaad vector.
 * They were the only control in the application and they went unused: they hung
 * in front of the phenomenon, they had to be dodged around by the camera
 * placement, and choosing between abstract standpoints is not what an observer
 * wants to do while a verse is playing. They are gone. The standpoint is now
 * adopted automatically from the phenomenon's own emphasis (`standpointFor` in
 * the store), which is what those buttons were expressing anyway.
 *
 * What the observer actually needs is to choose WHERE TO GO. That is the drawer:
 * the experiences, the waypoints of the one being flown, and the reciter.
 *
 * The bottom edge is where a thumb reaches on a phone, and the drawer opens
 * upward from it. Nothing in the upper two-thirds of the screen is interactive,
 * so the field is never obstructed by something waiting to be tapped.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { useSession, activePhenomenon, currentRef, experienceOf, type Drawer } from '@/state/store';
import { peekAyahText } from '@/services/QuranTextService';
import { getSurah, toArabicNumerals } from '@/data/surahs';
import { PHENOMENON_BY_ID } from '@/data/phenomena';
import { RECITERS } from '@/data/reciters';
import { GROUPS, EXPERIENCES, labelOf, type Experience, type ExperienceGroup } from '@/data/experiences';
import { formatSolarTime, julianDay, localSolarTime, moonPhase, solarAltitude } from '@/astro/ephemeris';
import { bearingName, formatGeo, qiblaBearing } from '@/astro/geo';
import { CRUISE_SPEED, flight } from './flight';
import { shellOf } from './waypoints';

/** Past this many pixels a pointer movement is a swipe and not a tap. */
const SWIPE_THRESHOLD = 42;

/**
 * The transparent surface over the canvas.
 *
 * Swipes here move along the journey. They are a shortcut, not the navigation —
 * the drawer is the navigation — but a horizontal flick to the next ayah is the
 * gesture a reader reaches for without being told, and refusing it would be
 * perverse.
 */
function GestureSurface() {
  const unlocked = useSession((state) => state.unlocked);
  const unlock = useSession((state) => state.unlock);
  const advance = useSession((state) => state.advance);
  const retreat = useSession((state) => state.retreat);
  const drawer = useSession((state) => state.drawer);
  const openDrawer = useSession((state) => state.openDrawer);
  const veil = useSession((state) => state.veil);
  const setVeil = useSession((state) => state.setVeil);

  const start = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      className="isnaad-gesture"
      onPointerDown={(event) => { start.current = { x: event.clientX, y: event.clientY }; }}
      onPointerCancel={() => { start.current = null; }}
      onPointerUp={(event) => {
        const origin = start.current;
        start.current = null;
        if (!origin) return;

        const dx = event.clientX - origin.x;
        const dy = event.clientY - origin.y;

        if (!unlocked) {
          // The one unavoidable gesture: a browser will not open an
          // AudioContext without it. Either a tap or a swipe will do — refusing
          // a swipe here would leave the observer flicking at a dead universe.
          unlock();
          return;
        }

        if (Math.hypot(dx, dy) >= SWIPE_THRESHOLD) {
          // In an RTL interface a leftward drag advances, matching the reading
          // order the rest of the application uses.
          if (Math.abs(dx) >= Math.abs(dy)) (dx < 0 ? advance : retreat)();
          else if (dy < 0) openDrawer('experiences');   // a swipe up reaches the drawer
          else openDrawer('none');
          return;
        }

        // A tap dismisses the drawer if one is open, and otherwise clears the
        // view — which is the only way to see the field with nothing over it.
        if (drawer !== 'none') openDrawer('none');
        else setVeil(!veil);
      }}
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
      {!unlocked && <p className="isnaad-veil__gate">المس لتبدأ السير</p>}
      <p className="isnaad-veil__ayah">{text ?? (textLoading ? '…' : '')}</p>
      <p className="isnaad-veil__key">{getSurah(surah).name} · {toArabicNumerals(ayah)}</p>
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
 * is the great-circle bearing to the Kaaba from there, and the speed is the
 * vehicle's own, taken from the flight state rather than inferred.
 */
function Readout() {
  const waypoint = useSession((state) => state.waypoint);
  const phenomenon = useSession((state) => activePhenomenon(state));
  const experience = useSession(experienceOf);
  const position = useSession((state) => state.position);
  const veil = useSession((state) => state.veil);

  // Half a second. These change slowly and this is a text layer on top of a
  // WebGL canvas that wants every millisecond it can get.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, []);

  if (!veil) return null;

  const jd = julianDay();
  const altitude = solarAltitude(jd, waypoint.at);
  const moon = moonPhase(jd);

  return (
    <div className="isnaad-readout">
      <div className="isnaad-readout__row isnaad-readout__row--wide">
        <span className="isnaad-readout__label">المسار</span>
        <span>{experience.title}</span>
      </div>
      <div className="isnaad-readout__row">
        <span className="isnaad-readout__label">المحطة</span>
        <span>
          {toArabicNumerals(position + 1)} / {toArabicNumerals(experience.count)}
          {' · '}
          {PHENOMENON_BY_ID[phenomenon].title}
        </span>
      </div>
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
        <span>{bearingName(qiblaBearing(waypoint.at))} · {toArabicNumerals(Math.round(qiblaBearing(waypoint.at)))}°</span>
      </div>
      <div className="isnaad-readout__row">
        <span className="isnaad-readout__label">القمر</span>
        <span>{toArabicNumerals(Math.round(moon.illumination * 100))}٪ · {moon.waxing ? 'متزايد' : 'متناقص'}</span>
      </div>
      <div className="isnaad-readout__row">
        <span className="isnaad-readout__label">الغلاف</span>
        <span>{toArabicNumerals(shellOf(waypoint.index))}</span>
      </div>
      <Velocity />
    </div>
  );
}

/**
 * السرعة — the one readout that has to sample at frame rate.
 *
 * It writes into a ref rather than through React state: at 8 Hz through the
 * store this would re-render the readout's whole subtree eighty times a minute
 * for one number. The DOM node is updated directly.
 */
function Velocity() {
  const node = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const step = (time: number) => {
      raf = requestAnimationFrame(step);
      if (time - last < 120) return;      // ~8 Hz is as fast as a number can be read
      last = time;
      if (node.current) {
        const ratio = flight.smoothSpeed / CRUISE_SPEED;
        const bars = Math.round(Math.min(ratio, 1.5) * 8);
        node.current.textContent = `${'▮'.repeat(bars)}${'▯'.repeat(Math.max(0, 8 - bars))}`;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="isnaad-readout__row">
      <span className="isnaad-readout__label">السرعة</span>
      <span ref={node} className="isnaad-readout__meter">▯▯▯▯▯▯▯▯</span>
    </div>
  );
}

// ------------------------------------------------------------------- drawers

function ExperienceRow({ experience, active, onPick }: {
  experience: Experience; active: boolean; onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={`isnaad-row ${active ? 'is-active' : ''}`}
      onClick={onPick}
      style={{ '--row-accent': experience.accent } as React.CSSProperties}
    >
      <span className="isnaad-row__mark" />
      <span className="isnaad-row__body">
        <span className="isnaad-row__title">{experience.title}</span>
        <span className="isnaad-row__brief">{experience.brief}</span>
      </span>
      <span className="isnaad-row__count">{toArabicNumerals(experience.count)}</span>
    </button>
  );
}

function ExperiencesDrawer() {
  const experienceId = useSession((state) => state.experienceId);
  const enterExperience = useSession((state) => state.enterExperience);

  const [group, setGroup] = useState<ExperienceGroup>('كوني');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const inGroup = EXPERIENCES.filter((experience) => experience.group === group);
    const needle = query.trim();
    if (!needle) return inGroup;
    // Arabic text is matched as typed. Normalising alif and hamza forms would
    // be the next thing to add here, but a plain substring match already finds
    // "موسى" and "الكهف", which is what the field is for.
    return inGroup.filter((experience) =>
      experience.title.includes(needle) || experience.brief.includes(needle));
  }, [group, query]);

  return (
    <>
      <div className="isnaad-tabs">
        {GROUPS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`isnaad-tab ${group === entry.id ? 'is-active' : ''}`}
            onClick={() => setGroup(entry.id)}
          >
            {entry.title}
          </button>
        ))}
      </div>
      <p className="isnaad-drawer__note">{GROUPS.find((entry) => entry.id === group)?.brief}</p>
      <input
        className="isnaad-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="ابحث…"
        dir="rtl"
      />
      <div className="isnaad-list">
        {rows.map((experience) => (
          <ExperienceRow
            key={experience.id}
            experience={experience}
            active={experience.id === experienceId}
            onPick={() => enterExperience(experience.id)}
          />
        ))}
        {rows.length === 0 && <p className="isnaad-drawer__note">لا نتيجة</p>}
      </div>
    </>
  );
}

/**
 * The waypoints of the route being flown.
 *
 * A surah route can be 286 rows; the list is virtualised only by the browser's
 * own scrolling, which is enough because each row is a plain button with no
 * layout work of its own. The current waypoint is scrolled into view on open,
 * because opening the list at row 1 of سورة البقرة while standing at ayah 200
 * would be useless.
 */
function WaypointsDrawer() {
  const experience = useSession(experienceOf);
  const position = useSession((state) => state.position);
  const goTo = useSession((state) => state.goTo);
  const active = useRef<HTMLButtonElement>(null);

  const route = useMemo(() => experience.ayat(), [experience]);

  useEffect(() => {
    active.current?.scrollIntoView({ block: 'center' });
  }, []);

  return (
    <>
      <p className="isnaad-drawer__note">{experience.title} · {toArabicNumerals(experience.count)} محطة</p>
      <div className="isnaad-list">
        {route.map((ref, index) => (
          <button
            key={`${ref.surah}:${ref.ayah}:${index}`}
            ref={index === position ? active : undefined}
            type="button"
            className={`isnaad-row isnaad-row--compact ${index === position ? 'is-active' : ''}`}
            onClick={() => goTo(index)}
          >
            <span className="isnaad-row__index">{toArabicNumerals(index + 1)}</span>
            <span className="isnaad-row__title">{labelOf(ref)}</span>
            {ref.phenomenon && (
              <span className="isnaad-row__count">{PHENOMENON_BY_ID[ref.phenomenon].sigil}</span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}

function RecitersDrawer() {
  const reciter = useSession((state) => state.reciter);
  const setReciter = useSession((state) => state.setReciter);
  const provider = useSession((state) => state.provider);

  return (
    <>
      <p className="isnaad-drawer__note">
        كلّ آية تُجلب على حدة{provider ? ` · ${provider}` : ''}
      </p>
      <div className="isnaad-list">
        {RECITERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`isnaad-row ${entry.id === reciter ? 'is-active' : ''}`}
            onClick={() => setReciter(entry.id)}
          >
            <span className="isnaad-row__mark" />
            <span className="isnaad-row__body">
              <span className="isnaad-row__title">{entry.name}</span>
              <span className="isnaad-row__brief">{entry.register}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

const DRAWER_TITLES: Record<Exclude<Drawer, 'none'>, string> = {
  experiences: 'التجارب',
  waypoints: 'المحطات',
  reciters: 'القرّاء',
};

function DrawerSheet() {
  const drawer = useSession((state) => state.drawer);
  const openDrawer = useSession((state) => state.openDrawer);

  if (drawer === 'none') return null;

  return (
    <div className="isnaad-drawer" role="dialog" aria-label={DRAWER_TITLES[drawer]}>
      <div className="isnaad-drawer__grip" />
      <div className="isnaad-drawer__head">
        <span className="isnaad-drawer__title">{DRAWER_TITLES[drawer]}</span>
        <button type="button" className="isnaad-drawer__close" onClick={() => openDrawer('none')}>
          إغلاق
        </button>
      </div>
      {drawer === 'experiences' && <ExperiencesDrawer />}
      {drawer === 'waypoints' && <WaypointsDrawer />}
      {drawer === 'reciters' && <RecitersDrawer />}
    </div>
  );
}

/** The controls along the bottom edge — the whole of the deliberate interface. */
function ControlBar() {
  const drawer = useSession((state) => state.drawer);
  const openDrawer = useSession((state) => state.openDrawer);
  const playing = useSession((state) => state.playing);
  const toggleTransport = useSession((state) => state.toggleTransport);
  const experience = useSession(experienceOf);
  const ref = useSession(currentRef);
  // A selector, not `getState()`: read outside the store's subscription and the
  // label would keep showing the reciter that was current when the bar mounted.
  const reciter = useSession((state) => state.reciter);

  return (
    <nav className="isnaad-bar">
      <button
        type="button"
        className={`isnaad-bar__button ${drawer === 'experiences' ? 'is-open' : ''}`}
        onClick={() => openDrawer('experiences')}
      >
        <span className="isnaad-bar__label">التجارب</span>
        <span className="isnaad-bar__value">{experience.sigil}</span>
      </button>

      <button
        type="button"
        className={`isnaad-bar__button ${drawer === 'waypoints' ? 'is-open' : ''}`}
        onClick={() => openDrawer('waypoints')}
      >
        <span className="isnaad-bar__label">المحطات</span>
        <span className="isnaad-bar__value">{labelOf(ref)}</span>
      </button>

      <button
        type="button"
        className="isnaad-bar__button isnaad-bar__button--transport"
        onClick={toggleTransport}
        aria-label={playing ? 'إيقاف' : 'تشغيل'}
      >
        <span className="isnaad-bar__glyph">{playing ? '❙❙' : '▶'}</span>
      </button>

      <button
        type="button"
        className={`isnaad-bar__button ${drawer === 'reciters' ? 'is-open' : ''}`}
        onClick={() => openDrawer('reciters')}
      >
        <span className="isnaad-bar__label">القارئ</span>
        <span className="isnaad-bar__value">
          {RECITERS.find((entry) => entry.id === reciter)?.name ?? ''}
        </span>
      </button>
    </nav>
  );
}

export function Interface() {
  const unlocked = useSession((state) => state.unlocked);

  return (
    <>
      <Readout />
      <Veil />
      {/* The gesture surface sits under everything interactive, so a tap on a
          control reaches the control and a tap on the field reaches the field. */}
      <GestureSurface />
      {unlocked && (
        <>
          <DrawerSheet />
          <ControlBar />
        </>
      )}
    </>
  );
}
