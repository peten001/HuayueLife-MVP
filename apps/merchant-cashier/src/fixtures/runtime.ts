import { cashierConfig } from '@/config';

let demoSessionActive = false;

export function activateDemoSession() {
  if (!cashierConfig.fixturesEnabled) {
    throw new Error('Fixture mode is disabled');
  }
  demoSessionActive = true;
}

export function deactivateDemoSession() {
  demoSessionActive = false;
}

export function isDemoSessionActive() {
  return cashierConfig.fixturesEnabled && demoSessionActive;
}
