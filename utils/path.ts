import * as os from "os";
import path from "path";

export function resolvePath(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return path.resolve(os.homedir(), inputPath.slice(2));
  }
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(process.cwd(), inputPath);
}
