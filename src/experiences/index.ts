/**
 * Phenomenon → scene registry.
 *
 * The picker addresses scenes by PhenomenonId only; the mapping is exhaustive by
 * type, so adding a phenomenon to the registry without a scene is a build error
 * rather than a blank viewport.
 */

import type { ComponentType } from 'react';

import type { PhenomenonId } from '@/data/phenomena';
import type { SceneProps } from './types';

import { RatqFatqScene } from './01-RatqFatq';
import { TeenLazibScene } from './02-TeenLazib';
import { MawaqiNujumScene } from './03-MawaqiNujum';
import { SaqfMahfoozScene } from './04-SaqfMahfooz';
import { BahrMasjoorScene } from './05-BahrMasjoor';
import { MarjBahraynScene } from './06-MarjBahrayn';
import { HadeedBasScene } from './07-HadeedBas';
import { ZulumatLujjiyScene } from './08-ZulumatLujjiy';
import { NajmThaqibScene } from './09-NajmThaqib';
import { ZubarHadeedScene } from './10-ZubarHadeed';
import { TayySijillScene } from './11-TayySijill';
import { SarabScene } from './12-SarabBiQeeah';
import { NoorAlaNoorScene } from './13-NoorAlaNoor';
import { SahabThiqalScene } from './14-SahabThiqal';
import { ShajarahMubarakahScene } from './15-ShajarahMubarakah';
import { AwtadScene } from './16-Awtad';
import { DayyiqHarajScene } from './17-DayyiqHaraj';
import { KisafSamaScene } from './18-KisafSama';
import { HijrMahjoorScene } from './19-HijrMahjoor';
import { SaiqahScene } from './20-Saiqah';

export type { SceneProps };

export const EXPERIENCE_SCENES: Record<PhenomenonId, ComponentType<SceneProps>> = {
  'ratq-fatq': RatqFatqScene,
  'teen-lazib': TeenLazibScene,
  'mawaqi-nujum': MawaqiNujumScene,
  'saqf-mahfooz': SaqfMahfoozScene,
  'bahr-masjoor': BahrMasjoorScene,
  'marj-bahrayn': MarjBahraynScene,
  'hadeed-bas': HadeedBasScene,
  'zulumat-lujjiy': ZulumatLujjiyScene,
  'najm-thaqib': NajmThaqibScene,
  'zubar-hadeed': ZubarHadeedScene,
  'tayy-sijill': TayySijillScene,
  'sarab-bee-qee-ah': SarabScene,
  'noor-ala-noor': NoorAlaNoorScene,
  'sahab-thiqal': SahabThiqalScene,
  'shajarah-mubarakah': ShajarahMubarakahScene,
  awtad: AwtadScene,
  'dayyiq-haraj': DayyiqHarajScene,
  'kisaf-sama': KisafSamaScene,
  'hijr-mahjoor': HijrMahjoorScene,
  'sa-iqah': SaiqahScene,
};
