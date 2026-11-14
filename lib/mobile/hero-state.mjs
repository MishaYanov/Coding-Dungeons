import {maxHp, potionRecovery, submissionDamage} from '../combat-rules.mjs';

const emptyEvent = Object.freeze({damage:0, healing:0, potionsEarned:0});
const ids = /^[A-Za-z0-9_-]{1,64}$/;

export const responseKey = (page, id) => `${page}:${id}`;
export const nameKey = name => name.normalize('NFKC').toLowerCase().trim();
export const heroIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function createHeroRecord(hero) {
  return {
    hero, levels:{}, responses:{}, modes:{}, attempts:[], clears:{}, encounters:{},
    trialIds:[], rewards:[], receipts:[], diamond:null,
    hp:hero.oneLife ? maxHp : null, potions:hero.oneLife ? 1 : 0,
  };
}

export function combat(record) {
  const oneLife = record.hero.oneLife === true;
  return {mode:oneLife ? 'one-life' : 'standard', oneLife, hp:record.hp, maxHp:oneLife ? maxHp : null,
    potions:record.potions, fallen:record.hp === 0, completedTrials:[...record.trialIds].sort()};
}

export function checkAlive(record) {
  if (record.hp === 0) throw new Error('This hero has fallen. Choose another hero to keep submitting.');
}

export function modeFor(record, level) {
  return record.modes[level] ?? {mode:'guided', assisted:false};
}

export function setMode(record, level, mode) {
  const next = {...modeFor(record, level), mode};
  record.modes[level] = next;
  return next;
}

export function revealAid(record, level, unlocked, reason) {
  const mode = modeFor(record, level);
  if (mode.mode === 'hard' && !unlocked) throw new Error(reason);
  record.modes[level] = {...mode, assisted:true};
}

export function saveResponse(record, page, promptId, value, feedback, correct = null, assessment) {
  record.responses[responseKey(page, promptId)] = {page, promptId, value, feedback, correct,
    ...(assessment ? {assessment} : {})};
}

export async function submission(record, id, identity, requireId = false) {
  const submissionId = id ?? (requireId || record.hero.oneLife ? null : crypto.randomUUID());
  if (typeof submissionId !== 'string' || !ids.test(submissionId)) throw new Error('Send a valid submission ID.');
  const fingerprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(identity)));
  return {id:submissionId, fingerprint:Array.from(new Uint8Array(fingerprint), byte => byte.toString(16).padStart(2, '0')).join('')};
}

export function receipt(record, ticket) {
  const previous = record.receipts.find(entry => entry.id === ticket.id);
  if (!previous) return null;
  if (previous.fingerprint !== ticket.fingerprint) throw new Error('This submission ID has already been used.');
  const result = previous.result?.newClear ? {...previous.result, newClear:false} : previous.result;
  return {result, combatEvent:emptyEvent};
}

export function settle(record, ticket, action, {wrong = false, rewardKey, trialId, potion = false} = {}) {
  const previous = receipt(record, ticket);
  if (previous) return previous;
  checkAlive(record);
  const result = action();
  let healing = 0;
  let damage = 0;
  let potionsEarned = 0;
  if (potion) {
    if (!record.potions) throw new Error('This hero has no potions.');
    healing = potionRecovery(record.hp);
    if (!healing) throw new Error('Health is already full.');
    record.hp += healing;
    record.potions--;
  } else {
    if (!wrong && trialId && !record.trialIds.includes(trialId)) record.trialIds.push(trialId);
    const reward = trialId ? `trial:${trialId}` : rewardKey;
    if (record.hero.oneLife) {
      if (wrong) {
        damage = submissionDamage(record.hp, wrong);
        record.hp -= damage;
      } else if (reward && !record.rewards.includes(reward)) {
        record.rewards.push(reward);
        record.potions++;
        potionsEarned = 1;
      }
    }
  }
  record.receipts.push({...ticket, result});
  return {result, combatEvent:{damage, healing, potionsEarned}};
}

export function combatResult(record, {result, combatEvent = emptyEvent}, includeStandard = false) {
  return includeStandard || record.hero.oneLife ? {...result, combat:combat(record), combatEvent} : result;
}
