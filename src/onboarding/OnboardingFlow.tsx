/**
 * بروتوكول المعايرة الانغماسي — the three-stage cinematic onboarding.
 *
 * Runs once per browser (the completion flag lives in the session store, backed
 * by localStorage). The full interactive viewport is not revealed until the
 * protocol completes.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { audioEngine } from '@/audio/AudioEngine';
import { useSession } from '@/state/store';
import { StageIstiadha } from './StageIstiadha';
import { StageNaalayk } from './StageNaalayk';
import { StageAlwah } from './StageAlwah';

export function OnboardingFlow() {
  const [stage, setStage] = useState(0);
  const completeCalibration = useSession((state) => state.completeCalibration);
  const navigate = useNavigate();

  const finish = () => {
    // Reopen the band the clearance sweep closed, then hand over the viewport.
    audioEngine.openFilter(1.6);
    completeCalibration();
    navigate('/', { replace: true });
  };

  return (
    <main className="h-full w-full bg-vacuum text-slate-200" dir="rtl">
      {stage === 0 && <StageIstiadha onComplete={() => setStage(1)} />}
      {stage === 1 && <StageNaalayk onComplete={() => setStage(2)} />}
      {stage === 2 && <StageAlwah onComplete={finish} />}
    </main>
  );
}
