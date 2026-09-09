/**
 * The application.
 *
 * One universe and one interface over it. There is no router: there is nowhere
 * to route to. The journey opens automatically, advances on its own, and is
 * steered only by which isnaad orientation the observer adopts.
 */

import { JourneyRoot } from '@/journey/JourneyRoot';
import { Interface } from '@/journey/Interface';

export default function App() {
  return (
    <>
      <JourneyRoot />
      <Interface />
    </>
  );
}
