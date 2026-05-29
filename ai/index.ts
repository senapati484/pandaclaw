import { getPythonInfo } from './providers/python.ts';

export function getLanguageInfo(): string {
  return getPythonInfo();
}