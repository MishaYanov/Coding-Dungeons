const bytes = new TextEncoder();
export const codeLimit = 48 * 1024;
export const textLimit = 20 * 1024;
export const mobileBackupLimit = 16 * 1024 * 1024;

export function mobileReaderKey(worldId, key, heroId) {
  return worldId === 'javascript' ? `${key}:${heroId}` : `${key}:${worldId}:${heroId}`;
}

export function checkedText(value, limit, label) {
  if (typeof value !== 'string' || bytes.encode(value).length > limit) {
    throw new Error(`${label} must be a string of at most ${limit} bytes.`);
  }
  return value;
}

export function codeInput({code, purpose = 'submit'}) {
  if (!['examples', 'submit'].includes(purpose)) throw new Error('Choose Run Examples or Submit.');
  checkedText(code, codeLimit, 'Code');
  if (!code.trim()) throw new Error('Enter code before running tests.');
  return {code, purpose};
}
