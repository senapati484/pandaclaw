import { getPythonInfo } from './providers/python.ts';

export function getLanguageInfo(): string {
  return getPythonInfo();
}

// Context compression — import these instead of JSON.stringify(session)
export {
  compressCodebaseIndex,
  compressActionHistory,
  compressFileContent,
  compressMemoryForPrompt,
  sliceContextForWorker,
  buildPromptContext,
} from './context-compressor.ts';