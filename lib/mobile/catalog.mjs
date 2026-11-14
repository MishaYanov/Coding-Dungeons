import book from '../../data/worlds/javascript/campaign.json' with {type:'json'};
import chapters from '../../data/worlds/javascript/pages.json' with {type:'json'};
import rubrics from '../../data/gm-rubrics.json' with {type:'json'};
import exercises from '../../data/workbench/javascript.mjs';
import refactoring from '../../data/workbench/refactoring.mjs';
import systemDesign from '../../data/workbench/system-design.mjs';
import rateLimiter from '../../data/workbench/rate-limiter.mjs';
import { suggestions } from '../../data/workbench/suggestions.mjs';
import { encounters, publicEncounter } from '../encounters.mjs';
import { workbenchSummary } from '../workbench-report.mjs';

export const worldId = 'javascript';
export const questMap = new Map(book.quests.map(quest => [quest.level, quest]));
export const routes = new Set(['all', '', ...book.paths.map(path => path.id)]);
export const encounterMap = new Map(encounters.filter(encounter => encounter.world === worldId)
  .map(encounter => [encounter.id, encounter]));
export const rubricMap = new Map(rubrics.filter(rubric => rubric.worldId === worldId)
  .map(rubric => [rubric.promptId, rubric]));

export const sideQuestMap = new Map([
  ['/api/refactoring', {key:'refactoring', slug:'refactoring', level:14, catalog:refactoring}],
  ['/api/system-design', {key:'systemDesign', slug:'system-design', level:13, catalog:systemDesign}],
  ['/api/rate-limiter', {key:'rateLimiter', slug:'rate-limiter', level:12, catalog:rateLimiter}],
].map(([path, definition]) => {
  const {level, catalog} = definition;
  return [path, {...definition, page:questMap.get(level).sidePage, title:catalog.title, description:catalog.description}];
}));

export const exerciseMap = new Map(exercises.map(exercise => {
  const quest = questMap.get(exercise.level);
  const prompt = chapters[quest.bossPage - 1].prompts.find(item => item.id === `boss-${exercise.level}`);
  return [exercise.id, {...exercise, page:quest.bossPage, promptId:prompt.id,
    title:exercise.title ?? quest.title, description:exercise.description ?? prompt.body,
    starter:exercise.starter ?? prompt.starter}];
}));
export const bossByLevel = new Map([...exerciseMap.values()].map(exercise => [exercise.level, exercise.id]));

export function rubricFor(prompt) {
  const rubric = prompt.type === 'text' ? rubricMap.get(prompt.id) : null;
  return rubric?.question === prompt.body ? rubric : null;
}

export function localCatalog(assetUrl) {
  const world = {...book.world, bookUrl:assetUrl('/book/javascript/book.pdf'),
    kitUrl:assetUrl('/book/javascript/field-kit.zip')};
  const campaign = {
    world, zones:book.zones ?? [], paths:book.paths,
    quests:book.quests.map(({hint1, hint2, debrief, ...quest}) => quest),
    rooms:book.rooms.map(room => ({...room, choices:room.choices.map(({result,...choice}) => choice)})),
    specialEncounters:[...encounterMap.values()].map(publicEncounter),
    exercises:[...exerciseMap.values()].map(exercise => ({...workbenchSummary(exercise), page:exercise.page})),
    levelPages:Object.fromEntries(book.quests.map(quest => [quest.level, quest.page])),
    total:chapters.length,
  };
  campaign.sideQuests = [...sideQuestMap.values()].map(({key, slug, page, title, description}) => ({
    key, slug, page, title, description,
  }));
  for (const quest of campaign.sideQuests) campaign[quest.key] = quest;
  const pages = chapters.map(chapter => ({...chapter, image:assetUrl(chapter.image),
    prompts:chapter.prompts.map(prompt => {
      const exerciseId = chapter.page === questMap.get(chapter.level)?.bossPage && prompt.id === `boss-${chapter.level}`
        ? bossByLevel.get(chapter.level) : prompt.exerciseId;
      return {...prompt, exerciseId};
    })}));
  return {world, campaign, pages};
}

export function visiblePage(page) {
  return {...page, prompts:page.prompts.map(({feedback, feedbackByOption, correctOption, ...prompt}) => ({
    ...prompt,
    ...(rubricFor(prompt) ? {assessment:{version:'mobile-1', kind:'rule-based'}} : {}),
    ...(suggestions.has(prompt.exerciseId) ? {suggestion:true} : {}),
  }))};
}
