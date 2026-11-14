import { createHash } from 'node:crypto';
import { workbenchSummary } from './workbench-report.mjs';
import { definitions, description, encounterId, evaluateDiamondChoice, evaluateDiamondCode, exerciseDescription,
  exerciseTitle, pageBlockSize, rewardDiamonds, riddles, stages, title } from './diamond-content.mjs';

export { evaluateDiamondChoice, evaluateDiamondCode };

const exercises = new Map(Object.entries(definitions).map(([world, exercise]) => {
  const definition = JSON.stringify([exercise.tests, exercise.testNames, exercise.typeTests]);
  const suiteRevision = createHash('sha256').update(definition).digest('hex').slice(0, 12);
  return [world, {id:`${world}-${encounterId}`, title:exerciseTitle, description:exerciseDescription, suiteRevision, ...exercise}];
}));

const publicStages = new Map([...exercises].map(([world, exercise]) => {
  const {prompt, options} = riddles[world];
  return [world, [
    {...workbenchSummary(exercise), id:'code', kind:'code', prompt:exerciseDescription},
    {id:'choice', kind:'choice', title:'Answer the goblin’s riddle', prompt, options},
  ]];
}));

export function diamondExercise(world) {
  return exercises.get(world);
}

function diamondError(code, message) {
  return Object.assign(new Error(message), {code});
}

function hiddenSparkle(heroId, world, page, totalPages) {
  if (!Number.isInteger(page) || page < 1 || page > totalPages) return null;
  const start = page - ((page - 1) % pageBlockSize);
  const length = Math.min(pageBlockSize, totalPages - start + 1);
  // Make discoveries stable on reload and guaranteed in every page block.
  const seed = createHash('sha256').update(JSON.stringify([heroId, world, start])).digest();
  if (page !== start + (seed[0] % length)) return null;
  return {x:10 + (seed[1] % 81), y:8 + (seed[2] % 85)};
}

export function diamondView(store, heroId, world, page, totalPages) {
  const started = store.diamondEncounter(heroId);
  if (!started) {
    const sparkle = store.combatState(heroId).fallen ? null : hiddenSparkle(heroId, world, page, totalPages);
    return {sparkle, encounter:null, completed:[], diamonds:0, draft:''};
  }
  const results = store.encounterResults(heroId, encounterId);
  const completed = stages.filter(stage => results.has(stage));
  const diamonds = completed.includes('choice') ? rewardDiamonds : 0;
  const encounter = {id:encounterId, title, description, page:started.page, rewardDiamonds, stages:publicStages.get(world)};
  return {sparkle:null, encounter, completed, diamonds, draft:started.draft};
}

export function startDiamond(store, heroId, world, page, totalPages) {
  return store.withEncounter(() => {
    const current = diamondView(store, heroId, world, page, totalPages);
    if (current.encounter) return current;
    if (store.combatState(heroId).fallen) throw diamondError('HERO_FALLEN', 'This hero has fallen.');
    if (!current.sparkle) throw diamondError('DIAMOND_NOT_FOUND', 'There is no diamond on this page.');
    store.startDiamondEncounter(heroId, page);
    return diamondView(store, heroId, world);
  });
}

export function diamondStage(store, heroId, world, stageId) {
  const available = publicStages.get(world);
  if (!available?.some(stage => stage.id === stageId)) throw diamondError('DIAMOND_STAGE_INVALID', 'Choose a stage from the goblin fight.');
  if (!store.diamondEncounter(heroId)) throw diamondError('DIAMOND_NOT_FOUND', 'Find a diamond to start this fight.');
  const results = store.encounterResults(heroId, encounterId);
  if (results.has(stageId)) return results.get(stageId);
  if (stageId === 'choice' && !results.has('code')) throw diamondError('DIAMOND_STAGE_LOCKED', 'Crack the sack lock before answering the riddle.');
}

export function refreshDiamondOutcome(store, heroId, world, outcome) {
  return {...outcome, result:{...diamondView(store, heroId, world), result:outcome.result.result}};
}

export function settleDiamond(store, heroId, world, stageId, ticket, attempt) {
  return store.withEncounter(() => {
    const prior = store.combatReceipt(heroId, ticket);
    if (prior) return refreshDiamondOutcome(store, heroId, world, prior);
    const completed = diamondStage(store, heroId, world, stageId);
    const noGradedResult = stageId === 'code' && (attempt.purpose === 'examples' || !['pass','fail','compile_error'].includes(attempt.verdict));
    if (completed || noGradedResult) {
      return refreshDiamondOutcome(store, heroId, world, {
        result:{result:completed ?? attempt}, combat:store.combatState(heroId),
        combatEvent:{damage:0, healing:0, potionsEarned:0}, replayed:!!completed,
      });
    }
    const rewardKey = stageId === 'choice' && attempt.correct ? `encounter:${encounterId}` : undefined;
    const outcome = store.settleCombat(heroId, {...ticket, wrong:!attempt.correct, rewardKey}, () => {
      if (attempt.correct) store.recordEncounterStage(heroId, encounterId, stageId, attempt);
      return {result:attempt};
    });
    return refreshDiamondOutcome(store, heroId, world, outcome);
  });
}
