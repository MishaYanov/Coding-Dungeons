import { join } from 'node:path';

const desktopHeader = 'x-ferrum-desktop-token';
const childEnvironmentKeys = new Set(['SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'LOCALAPPDATA', 'TEMP', 'TMP']);

export function engineOrigin(message) {
  const port = message?.port;
  if (message?.type !== 'ferrum-ready' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return `http://127.0.0.1:${port}`;
}

export function isEngineUrl(value, origin) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function engineHeaders(url, origin, token, requestHeaders) {
  const headers = Object.fromEntries(Object.entries(requestHeaders).filter(
    ([name]) => name.toLowerCase() !== desktopHeader,
  ));
  if (isEngineUrl(url, origin)) headers[desktopHeader] = token;
  return headers;
}

export function engineEnvironment({appPath, userData, token, model, nativeRunner, hostEnvironment = process.env}) {
  const env = Object.fromEntries(Object.entries(hostEnvironment).filter(
    ([name]) => childEnvironmentKeys.has(name.toUpperCase()),
  ));
  Object.assign(env, {
    PORT: '0',
    FERRUM_DB: join(userData, 'state', 'ferrum.sqlite'),
    FERRUM_PUBLIC_DIR: join(appPath, 'dist', 'renderer'),
    FERRUM_DESKTOP_TOKEN: token,
  });
  if (model) {
    env.FERRUM_LLM_CLI = model.cli;
    env.FERRUM_LLM_MODEL = model.weights;
  }
  if (nativeRunner) env.DUNGEONS_NATIVE_RUNNER_DIR = nativeRunner;
  return env;
}
