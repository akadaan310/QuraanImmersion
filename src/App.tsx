import { Navigate, Route, Routes } from 'react-router-dom';

import { OnboardingFlow } from '@/onboarding/OnboardingFlow';
import { ImmersionRoute } from '@/routes/ImmersionRoute';
import { ExperienceRoute } from '@/routes/ExperienceRoute';
import { SpatialRoute } from '@/routes/SpatialRoute';
import { IsnaadRoute } from '@/routes/IsnaadRoute';
import { useSession } from '@/state/store';

/** First-time observers are held at the calibration protocol. */
function RequireCalibration({ children }: { children: JSX.Element }) {
  const calibrated = useSession((state) => state.calibrated);
  return calibrated ? children : <Navigate to="/onboarding" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingFlow />} />
      <Route
        path="/"
        element={
          <RequireCalibration>
            <ImmersionRoute />
          </RequireCalibration>
        }
      />
      <Route
        path="/experiences/:slug"
        element={
          <RequireCalibration>
            <ExperienceRoute />
          </RequireCalibration>
        }
      />
      <Route
        path="/engine/spatial"
        element={
          <RequireCalibration>
            <SpatialRoute />
          </RequireCalibration>
        }
      />
      <Route
        path="/engine/isnaad"
        element={
          <RequireCalibration>
            <IsnaadRoute />
          </RequireCalibration>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
