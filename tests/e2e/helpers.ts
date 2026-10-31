import { join } from 'node:path';

const here = import.meta.dirname;
export const fixture = (name: string) => join(here, '..', 'fixtures', name);
export const artifacts = join(here, 'artifacts');

/** Chromium flags that make a WAV file act as the microphone. */
export function fakeMicArgs(wav: string, loop = false) {
  return [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}${loop ? '' : '%noloop'}`,
    '--autoplay-policy=no-user-gesture-required',
  ];
}
