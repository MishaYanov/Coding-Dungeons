import { validMerchantState } from '../merchant.mjs';
import { earnedDiamonds } from './encounters.mjs';
import { heroIdPattern, maxPotions, nameKey, responseKey } from './hero-state.mjs';
import { codeLimit, mobileBackupLimit, mobileReaderKey } from './input.mjs';

const encoder = new TextEncoder();
const maxReaderBytes = 2 * 1024 * 1024;
const draftKey = (world, id) => mobileReaderKey(world, 'ferrum-prompt-drafts-v2', id);
const pageKey = (world, id) => mobileReaderKey(world, 'ferrum-last-page-v2', id);
const keyPattern = /^[A-Za-z0-9_-]{1,100}$/;
const draftPattern = /^([1-9]\d{0,3}):[A-Za-z0-9_-]{1,100}$/;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const string = value => typeof value === 'string';
const text = (value, max = 4096) => string(value) && encoder.encode(value).length <= max;
const bool = value => typeof value === 'boolean';
const count = (value, min, max) => Number.isSafeInteger(value) && min <= value && value <= max;
const all = (values, max, check) => Array.isArray(values) && values.length <= max && values.every(check);
const optional = (value, check) => value === undefined || check(value);
const fields = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const validTime = value => text(value, 40) && Number.isFinite(Date.parse(value));
const validKey = key => keyPattern.test(key) && !Object.hasOwn(Object.prototype, key);
function rows(value, max, check) {
  if (!object(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= max && entries.every(check);
}

function validReport(value) {
  return object(value)
    && optional(value.output, string)
    && optional(value.groups, groups => Array.isArray(groups) && groups.every(group =>
      object(group) && string(group.group) && Number.isSafeInteger(group.passed) && Number.isSafeInteger(group.required)))
    && optional(value.cases, cases => Array.isArray(cases) && cases.every(test =>
      object(test) && string(test.id) && optional(test.message, string)))
    && optional(value.trace, trace => Array.isArray(trace) && trace.every(string))
    && optional(value.checks, checks => Array.isArray(checks) && checks.every(check =>
      object(check) && string(check.label) && bool(check.passed)));
}

function validResult(value) {
  return validReport(value) && optional(value.feedback, string) && text(JSON.stringify(value), 64 * 1024);
}

function validReceiptResult(value) {
  if (value === null) return true;
  const validFeedback = feedback => string(feedback)
    || Array.isArray(feedback) && Number.isSafeInteger(value.total) && Number.isSafeInteger(value.passed)
      && feedback.every(item => object(item) && bool(item.correct) && string(item.explanation));
  return validReport(value)
    && optional(value.feedback, validFeedback)
    && optional(value.result, validResult)
    && optional(value.completed, completed => Array.isArray(completed) && completed.every(string))
    && optional(value.assessment, validAssessment)
    && text(JSON.stringify(value), 64 * 1024);
}

function validAssessment(value) {
  return object(value) && ['scored', 'clarify', 'unavailable'].includes(value.status)
    && (value.score === null || count(value.score, 0, 100)) && text(value.feedback) && text(value.rubricVersion, 32);
}

function validHeroRecord(record, {totalPages, routes, questMap, exerciseMap, encounterStages, modeLevels}) {
  if (!object(record) || !fields(record, ['hero','levels','responses','modes','attempts','clears','encounters',
    'trialIds','rewards','receipts','diamond','hp','potions','merchant'])) return false;
  const {hero, hp, potions} = record;
  const page = value => count(value, 1, totalPages);
  if (!object(hero) || !fields(hero, ['id','name','path','lastPage','updatedAt','oneLife'])
    || !text(hero.id, 36) || !heroIdPattern.test(hero.id) || !text(hero.name, 60) || !nameKey(hero.name)
    || /[\u0000-\u001f\u007f]/.test(hero.name)
    || !routes.has(hero.path) || !page(hero.lastPage) || !validTime(hero.updatedAt)
    || (hero.oneLife !== undefined && !bool(hero.oneLife))) return false;
  if (hero.oneLife ? (!count(hp, 0, 100) || !count(potions, 0, maxPotions)) : (hp !== null || potions !== 0)) return false;
  if (!rows(record.levels, questMap.size, ([key, value]) => String(Number(key)) === key
    && questMap.has(Number(key)) && object(value)
    && value.level === Number(key) && fields(value, ['level','scout','forge','explain','side','answer','code'])
    && ['scout','forge','explain','side'].every(field => value[field] === undefined || bool(value[field]))
    && (value.answer === undefined || text(value.answer, codeLimit)) && (value.code === undefined || text(value.code, codeLimit)))) return false;
  if (!rows(record.responses, totalPages * 64, ([key, value]) => object(value) && fields(value, ['page','promptId','value','feedback','correct','assessment'])
    && page(value.page) && text(value.promptId, 100) && validKey(value.promptId) && key === responseKey(value.page, value.promptId)
    && text(value.value, codeLimit) && text(value.feedback) && (value.correct === null || bool(value.correct))
    && (value.assessment === undefined || validAssessment(value.assessment)))) return false;
  if (!rows(record.modes, modeLevels.size, ([key, value]) => String(Number(key)) === key
    && modeLevels.has(Number(key)) && object(value)
    && fields(value, ['mode','assisted']) && ['guided','hard'].includes(value.mode) && bool(value.assisted))) return false;
  if (!rows(record.clears, exerciseMap.size, ([key, value]) => exerciseMap.has(key) && object(value)
    && fields(value, ['level','hard']) && exerciseMap.get(key).level === value.level && bool(value.hard))) return false;
  if (!rows(record.encounters, encounterStages.size, ([id, result]) => encounterStages.has(id)
    && rows(result, encounterStages.get(id).size, ([stage, value]) => encounterStages.get(id).has(stage)
      && validResult(value) && value?.correct === true))) return false;
  if (!all(record.attempts, 100, value => validResult(value) && page(value?.page)
    && exerciseMap.get(value.exerciseId)?.level === value.level && validTime(value.createdAt))) return false;
  if (!all(record.receipts, Number.MAX_SAFE_INTEGER, value => object(value) && fields(value, ['id','fingerprint','result'])
    && text(value.id, 64) && /^[A-Za-z0-9_-]{1,64}$/.test(value.id)
    && text(value.fingerprint, 64) && /^[a-f0-9]{64}$/.test(value.fingerprint) && validReceiptResult(value.result))
    || new Set(record.receipts.map(receipt => receipt.id)).size !== record.receipts.length) return false;
  if (!all(record.trialIds, 10, id => text(id, 100) && validKey(id)) || !all(record.rewards, 100, id => text(id, 100)
    && /^(?:trial|encounter|forge):[A-Za-z0-9_-]+$/.test(id))) return false;
  if (!optional(record.merchant, state => validMerchantState(state, earnedDiamonds(record))
    && (hero.oneLife || state.potionsBought === 0))) return false;
  return record.diamond === null || object(record.diamond) && fields(record.diamond, ['page','draft'])
    && page(record.diamond.page) && text(record.diamond.draft, codeLimit);
}

function validReader(reader, totalPages, ids) {
  return rows(reader, ids.size, ([id, item]) => {
    if (!ids.has(id) || !object(item) || !fields(item, ['drafts','page'])) return false;
    if (item.page !== undefined && !count(item.page, 1, totalPages)) return false;
    return item.drafts === undefined || (rows(item.drafts, totalPages * 64, ([key, value]) => {
      const match = draftPattern.exec(key);
      return (key === 'diamond-goblin:code' || !!match && count(Number(match[1]), 1, totalPages))
        && text(value, maxReaderBytes);
    }) && text(JSON.stringify(item.drafts), maxReaderBytes));
  });
}

function readReader(storage, worldId, records, totalPages) {
  const reader = {};
  for (const {hero:{id}} of records) {
    const item = {};
    try {
      const drafts = storage?.getItem(draftKey(worldId, id));
      const page = Number(storage?.getItem(pageKey(worldId, id)));
      if (drafts && text(drafts, maxReaderBytes)) {
        const parsed = {drafts:JSON.parse(drafts)};
        if (validReader({[id]:parsed}, totalPages, new Set([id]))) item.drafts = parsed.drafts;
      }
      if (count(page, 1, totalPages)) item.page = page;
    } catch {
      // Reading position remains available in the saved hero.
    }
    if (Object.keys(item).length) reader[id] = item;
  }
  return reader;
}

function restoreReader(storage, worldId, reader) {
  let readerRestored = true;
  for (const [id, {drafts, page}] of Object.entries(reader)) {
    try {
      if (!storage) { readerRestored = false; continue; }
      if (drafts) storage.setItem(draftKey(worldId, id), JSON.stringify(drafts));
      if (page) storage.setItem(pageKey(worldId, id), String(page));
    } catch {
      readerRestored = false;
    }
  }
  return readerRestored;
}

function serialized(value) {
  let document;
  try { document = JSON.stringify(value); } catch { throw new Error('The backup is not readable JSON.'); }
  if (!text(document, mobileBackupLimit)) throw new Error('Mobile backups must be at most 16 MiB.');
  return document;
}

export function mobileBackup(repository, storage, {world, pages, routes, questMap, exerciseMap, encounterMap, sideQuestMap}) {
  const {id:worldId, name} = world;
  const totalPages = pages.length;
  const encounterStages = new Map([...encounterMap.values(), ...[...sideQuestMap.values()].map(({catalog}) => catalog)]
    .map(encounter => [encounter.id, new Set(encounter.stages.map(stage => stage.id))]));
  encounterStages.set('diamond-goblin', new Set(['code', 'choice']));
  const validation = {totalPages, routes, questMap, exerciseMap, encounterStages,
    modeLevels:new Set([...questMap.keys(), ...pages.map(page => page.level)])};

  async function exportBackup() {
    const heroes = await repository.list();
    const backup = {version:1, world:worldId, heroes, reader:readReader(storage, worldId, heroes, totalPages)};
    serialized(backup);
    return backup;
  }
  async function importBackup(value) {
    const backup = JSON.parse(serialized(value));
    if (!object(backup) || backup.version !== 1 || backup.world !== worldId
      || !all(backup.heroes, Number.MAX_SAFE_INTEGER, record => validHeroRecord(record, validation))) {
      throw new Error(`Choose a valid ${name} backup.`);
    }
    const ids = new Set(backup.heroes.map(({hero}) => hero.id));
    const names = new Set(backup.heroes.map(({hero}) => nameKey(hero.name)));
    const reader = backup.reader ?? {};
    if (ids.size !== backup.heroes.length || names.size !== backup.heroes.length || !validReader(reader, totalPages, ids)) {
      throw new Error(`The ${name} backup contains duplicate heroes or invalid reader data.`);
    }
    await repository.importEmpty(backup.heroes);
    return {imported:backup.heroes.length, readerRestored:restoreReader(storage, worldId, reader)};
  }
  return {exportBackup, importBackup};
}
