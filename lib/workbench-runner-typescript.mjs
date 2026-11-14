import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { compileTypeScriptWithLibraries } from './workbench-runner-typescript-core.mjs';

const compilerDirectory = dirname(createRequire(import.meta.url).resolve('typescript'));
const libraryFiles = new Set(readdirSync(compilerDirectory).filter(name => /^lib(?:\.[a-z0-9]+)+\.d\.ts$/.test(name)));
const libraryText = new Map();
const libraries = {
  has: name => libraryFiles.has(name),
  get(name) {
    if (!libraryFiles.has(name)) return undefined;
    if (!libraryText.has(name)) libraryText.set(name, readFileSync(join(compilerDirectory, name), 'utf8'));
    return libraryText.get(name);
  },
};

export function compileTypeScript(source, fixtures) {
  return compileTypeScriptWithLibraries(source, fixtures, libraries);
}
