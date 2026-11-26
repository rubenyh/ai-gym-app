import { Asset } from 'expo-asset';
import {
  Fit,
  Layout,
  RuntimeLoader,
  useRive,
  useViewModel,
  useViewModelInstance,
  useViewModelInstanceNumber,
} from '@rive-app/react-canvas';
import { useEffect } from 'react';
import { View } from 'react-native';

import ratingRiv from '@/assets/rive/rating.riv';

import { PET_FRAME, petStageName } from './pet';

// Serve the runtime from this app's own origin instead of the default public CDN (no third-party scripts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
RuntimeLoader.setWasmUrl(Asset.fromModule(require('@rive-app/canvas/rive.wasm')).uri);

/** Web body: same .riv file and `rating` view-model number as native, drawn by the canvas runtime. */
export function RivePet({ stage, onFail }: { stage: number; onFail: (reason?: string) => void }) {
  const { rive, RiveComponent } = useRive({
    src: Asset.fromModule(ratingRiv).uri,
    autoplay: true,
    autoBind: false,
    enableRiveAssetCDN: false,
    layout: new Layout({ fit: Fit.Contain }),
    onLoadError: () => onFail('Rive file failed to load'),
  });
  // Only files that define view models are asked for one; otherwise the runtime logs an error per load.
  const viewModel = useViewModel(rive && rive.viewModelCount > 0 ? rive : null, { useDefault: true });
  const instance = useViewModelInstance(viewModel, { useDefault: true, rive });
  const { setValue } = useViewModelInstanceNumber('rating', instance);

  useEffect(() => {
    if (instance) setValue(stage);
  }, [instance, setValue, stage]);

  return (
    <View
      testID="pet-rive"
      accessible
      accessibilityLabel={`Pet, stage ${stage}: ${petStageName(stage)} (placeholder art)`}
      style={PET_FRAME}>
      <RiveComponent aria-hidden style={{ width: PET_FRAME.width, height: PET_FRAME.height }} />
    </View>
  );
}
