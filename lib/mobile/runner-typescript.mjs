import { compileTypeScriptWithLibraries } from '../workbench-runner-typescript-core.mjs';
import libraries from 'virtual:workbench-typescript-libraries';

export function compileTypeScript(source, fixtures) {
  return compileTypeScriptWithLibraries(source, fixtures, libraries);
}
