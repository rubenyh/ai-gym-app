import { Fit, RiveView, useRiveFile, useRiveNumber, useViewModelInstance } from '@rive-app/react-native';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import ratingRiv from '@/assets/rive/rating.riv';

import { PET_FRAME, petStageName } from './pet';

/** Rive body; the stage drives the view-model `rating` number (stars) when the file exposes it. */
export function RivePet({ stage, onFail }: { stage: number; onFail: (reason?: string) => void }) {
  const { riveFile, isLoading, error } = useRiveFile(ratingRiv);
  const { instance } = useViewModelInstance(riveFile, { async: true });
  const { setValue } = useRiveNumber('rating', instance);

  useEffect(() => {
    if (error) onFail(error.message);
  }, [error, onFail]);
  useEffect(() => {
    if (instance) setValue(stage);
  }, [instance, setValue, stage]);

  if (error) return null;
  if (isLoading || !riveFile) return <ActivityIndicator accessibilityLabel="Loading pet" />;
  return (
    <View accessible accessibilityLabel={`Pet, stage ${stage}: ${petStageName(stage)} (placeholder art)`}>
      <RiveView
        testID="pet-rive"
        file={riveFile}
        fit={Fit.Contain}
        dataBind={instance ?? undefined}
        onError={(e) => onFail(e.message)}
        style={PET_FRAME}
      />
    </View>
  );
}

