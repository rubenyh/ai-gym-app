import { Redirect, useLocalSearchParams } from 'expo-router';

import { VerifyScreen } from '@/features/dev-verification/verify-screen';

/**
 * Development-only native verification (docs/IMPLEMENTATION_PLAN.md, M0).
 * Deep link: aigym://dev/verify?source=adb
 */
export default function DevVerifyRoute() {
  const { source } = useLocalSearchParams<{ source?: string }>();
  if (!__DEV__) return <Redirect href="/" />;
  return <VerifyScreen deepLinkSource={source} />;
}
