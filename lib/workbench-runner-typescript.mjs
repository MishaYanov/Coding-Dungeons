import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const compilerDirectory = dirname(createRequire(import.meta.url).resolve('typescript'));
const sourcePath = '/submission.ts';
const libraryPath = '/library';
const libraryFiles = new Set(readdirSync(compilerDirectory).filter(name => /^lib(?:\.[a-z0-9]+)+\.d\.ts$/.test(name)));
const libraryText = new Map();
const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Legacy,
  lib: ['lib.es2022.d.ts'],
  types: [],
  strict: true,
  noEmitOnError: true,
  skipLibCheck: true,
};

function virtualHost(files) {
  function libraryName(path) {
    return path.startsWith(`${libraryPath}/`) ? path.slice(libraryPath.length + 1) : '';
  }
  function readFile(path) {
    if (files.has(path)) return files.get(path);
    const name = libraryName(path);
    if (!libraryFiles.has(name)) return undefined;
    if (!libraryText.has(name)) libraryText.set(name, readFileSync(join(compilerDirectory, name), 'utf8'));
    return libraryText.get(name);
  }
  return {
    getSourceFile(path, version) {
      const contents = readFile(path);
      return contents === undefined ? undefined : ts.createSourceFile(path, contents, version);
    },
    getDefaultLibFileName: () => `${libraryPath}/lib.es2022.d.ts`,
    getDefaultLibLocation: () => libraryPath,
    writeFile() {},
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    fileExists: path => files.has(path) || libraryFiles.has(libraryName(path)),
    readFile,
    getCanonicalFileName: path => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
}

function diagnostic({ messageText, code, file, start }) {
  const message = ts.flattenDiagnosticMessageText(messageText, ' ').slice(0, 300);
  if (!file || start === undefined || file.fileName !== sourcePath) return { message, code };
  const position = file.getLineAndCharacterOfPosition(start);
  return { message, code, line: position.line + 1, column: position.character + 1 };
}

export function compileTypeScript(source, fixtures) {
  const file = ts.createSourceFile(sourcePath, source, compilerOptions.target, true);
  if (file.checkJsDirective || file.commentDirectives?.length) {
    return { diagnostics: [{ message: 'Remove TypeScript suppression comments before running the suite.' }] };
  }
  const module = ts.isExternalModule(file);
  const externalImport = file.statements.some(statement => ts.isImportDeclaration(statement)
    || ts.isImportEqualsDeclaration(statement) || (ts.isExportDeclaration(statement) && statement.moduleSpecifier));
  if (externalImport || file.referencedFiles.length || file.typeReferenceDirectives.length || file.libReferenceDirectives.length) {
    return { diagnostics: [{ message: 'Write the solution in one file using the bundled language library.' }] };
  }

  const files = new Map([[sourcePath, source]]);
  const options = compilerOptions;
  const host = virtualHost(files);
  const program = ts.createProgram({ rootNames: [sourcePath], options, host });
  const errors = ts.getPreEmitDiagnostics(program);
  if (errors.length) return { diagnostics: errors.slice(0, 8).map(diagnostic) };

  let emitted;
  const build = program.emit(program.getSourceFile(sourcePath), (path, code) => {
    if (path === '/submission.js') emitted = code;
  });
  if (build.emitSkipped || emitted === undefined) {
    return { diagnostics: [{ message: 'TypeScript could not emit the solution.' }] };
  }

  const tests = fixtures.map(({ id, code }, index) => {
    const started = performance.now();
    const fixturePath = `/type-fixture-${index}.ts`;
    files.set(fixturePath, code);
    const check = ts.createProgram({ rootNames: [sourcePath, fixturePath], options, host, oldProgram: program });
    const failed = ts.getPreEmitDiagnostics(check).length > 0;
    files.delete(fixturePath);
    const report = { id, status: failed ? 'failed' : 'passed', durationMs: Math.round(performance.now() - started) };
    if (failed) report.message = 'The solution did not satisfy the expected TypeScript contract.';
    return report;
  });

  return { source: emitted, module, tests, diagnostics: [] };
}
