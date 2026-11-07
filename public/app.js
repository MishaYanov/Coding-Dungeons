import { characterProgress, SKILL_LEVEL_CAP } from "./progression.mjs";
import { creatureName, mountCreature } from "./creatures.mjs";
import { createSpecialEncounter, encounterKind } from "./special-encounters.mjs";

const $ = (id) => document.getElementById(id);
const make = (tag, className = "", copy = "") => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = copy;
  return element;
};
const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === "string" ? value : "";
const enabled = (value) => value === true || value === 1 || value === "1";
const pageNumber = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const rustZones = [
  { name: "Borrowed Citadel", skill: "Ownership and borrowing", first: 1, last: 8 },
  { name: "Trait Foundry", skill: "Traits and API design", first: 9, last: 18 },
  { name: "Clockwork Wilds", skill: "Concurrency and async", first: 19, last: 28 },
  { name: "Unsafe Depths", skill: "Unsafe Rust and memory", first: 29, last: 36 },
  { name: "Endgame", skill: "Systems design", first: 37, last: 42 },
];
const hintLabels = { hint1: "Hint one", hint2: "Hint two", debrief: "Debrief" };
const promptLabels = { choice: "CHOICE", text: "WRITTEN RESPONSE", code: "CODE WORKBENCH" };
const pathTopics = new Map([
  ["architect", "Borrowing and lifetimes, traits and generics, dynamic dispatch, error design, and evolving library APIs."],
  ["warden", "Threads, locks and channels, atomic ordering, futures and pinning, cancellation, and graceful shutdown."],
  ["delver", "Memory layout, pointer validity, initialization and cleanup, C interoperability, and testing unsafe code."],
  ["pathfinder", "Borrowing parsers, transactional stores, bounded pipelines, reconnects and retries, and a final system design project."],
]);
const draftsKey = "ferrum-prompt-drafts-v2";
const lastPageKey = "ferrum-last-page-v2";
const selectedHeroKey = "ferrum-selected-hero-v1";

function readLocal(key) {
  try {
    if (window.codingDungeonsStorage) return window.codingDungeonsStorage.get(key);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    if (window.codingDungeonsStorage) return window.codingDungeonsStorage.set(key, value);
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function heroStorageKey(key, hero) {
  return `${key}:${hero.id}`;
}

function readDrafts(hero) {
  try {
    const saved = JSON.parse(readLocal(heroStorageKey(draftsKey, hero)) || "{}");
    return new Map(Object.entries(saved).filter(([, value]) => typeof value === "string"));
  } catch {
    return new Map();
  }
}

const state = {
  worlds: [],
  world: null,
  campaign: {},
  hero: null,
  switchingHero: false,
  heroListRequest: 0,
  heroCount: null,
  profile: { callsign: "Explorer", path: "" },
  levels: new Map(),
  responses: new Map(),
  attempts: [],
  workbenchModes: new Map(),
  hardClears: new Set(),
  creature: null,
  specialEncounter: null,
  drafts: new Map(),
  runner: "",
  storage: "",
  progressError: "",
  campaignError: "",
  page: null,
  total: null,
  requestNumber: 0,
  progressRequest: 0,
  zoom: 1,
  loading: false,
  ready: false,
};

async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = { Accept: "application/json" };
  if (state.world) headers["X-Ferrum-World"] = state.world.id;
  if (method !== "GET") {
    headers["X-Ferrum-Request"] = "1";
    headers["Content-Type"] = "application/json";
  }
  if (/^\/api\/(?:progress(?:\/|$)|profile$|answers(?:\/|$)|grade$|encounters\/|levels\/|workbench\/)/.test(path)) {
    const hero = options.hero || state.hero;
    if (!hero) throw new Error("Choose a hero to save your expedition.");
    headers["X-Ferrum-Hero"] = hero.id;
  }
  const response = await fetch(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
  });
  if (response.status === 204) return {};
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`The server returned an unreadable response (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(text(data?.error) || text(data?.message) || `Request failed (${response.status}).`);
  }
  return data || {};
}

function button(label, className = "button") {
  const element = make("button", className, label);
  element.type = "button";
  return element;
}

function bookLink(label, page, className = "") {
  const element = make("a", className, label);
  element.href = `#page=${page}`;
  return element;
}

function findQuest(level) {
  return list(state.campaign.quests).find((quest) => Number(quest.level) === Number(level));
}

function levelPage(level) {
  const quest = findQuest(level);
  return pageNumber(quest?.page ?? quest?.startPage ?? state.campaign.levelPages?.[level]);
}

function findExercise(id) {
  return list(state.campaign.exercises).find((exercise) => String(exercise.id) === String(id));
}

function levelExercises(level) {
  return list(state.campaign.exercises).filter((exercise) => Number(exercise.level) === Number(level));
}

function campaignZones() {
  const zones = list(state.campaign.zones);
  return zones.length ? zones : rustZones;
}

function zoneFor(level) {
  return campaignZones().find((zone) => level >= zone.first && level <= zone.last);
}

function responseKey(page, promptId) {
  return `${page}:${promptId}`;
}

function persistDraft(key, value) {
  if (!state.hero) return false;
  state.drafts.set(key, value);
  return writeLocal(heroStorageKey(draftsKey, state.hero), JSON.stringify(Object.fromEntries(state.drafts)));
}

function clearDraft(key, submittedValue) {
  if (!state.hero || state.drafts.get(key) !== submittedValue) return;
  state.drafts.delete(key);
  writeLocal(heroStorageKey(draftsKey, state.hero), JSON.stringify(Object.fromEntries(state.drafts)));
}

function setInlineStatus(element, copy, error = false) {
  element.textContent = copy;
  element.dataset.error = String(error);
}

let toastTimer;
function toast(copy) {
  clearTimeout(toastTimer);
  $("toast").textContent = copy;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4500);
}

function applyProgress(progress) {
  state.profile = {
    callsign: text(progress.profile?.callsign) || text(state.hero?.name) || "Explorer",
    path: progress.profile?.path === "all" ? "" : text(progress.profile?.path),
    lastPage: pageNumber(progress.profile?.lastPage),
  };
  state.levels = new Map(list(progress.levels).map((level) => [Number(level.level), level]));
  state.responses = new Map(list(progress.responses).map((response) => [
    responseKey(response.page, response.promptId), response,
  ]));
  state.attempts = list(progress.attempts);
  state.workbenchModes = new Map(list(progress.workbench?.modes).map((mode) => [mode.level, mode]));
  state.hardClears = new Set(list(progress.workbench?.hardClears));
  $("header-callsign").textContent = state.profile.callsign;
  $("open-profile").title = `Edit ${state.profile.callsign}`;
}

async function refreshProgress({ animateForgeLevel = null } = {}) {
  const hero = state.hero;
  if (!hero) return;
  const number = ++state.progressRequest;
  try {
    const progress = await api("/api/progress");
    if (hero !== state.hero || number !== state.progressRequest) return;
    applyProgress(progress);
    state.progressError = "";
    updateForgeBadge();
    updateCreature(animateForgeLevel);
    if ($("log-dialog").open) renderCharacterSheet();
  } catch (error) {
    if (hero !== state.hero || number !== state.progressRequest) return;
    state.progressError = error.message;
    throw error;
  }
}

function renderRunnerStatus() {
  const pill = $("runner-status");
  if (!list(state.campaign.exercises).length && state.world.id !== "rust") {
    pill.dataset.state = "ready";
    pill.lastElementChild.textContent = "Guided practice";
    pill.title = "Save your code and check it against the encounter debrief";
    return;
  }
  const available = state.runner.toLowerCase() === "available";
  pill.dataset.state = available ? "ready" : state.runner ? "limited" : "unknown";
  pill.lastElementChild.textContent = available ? `${state.world.name} runner ready`
    : state.runner ? `${state.world.name} runner offline` : "Runner status unknown";
  pill.title = [state.storage, state.runner && `${state.world.name} runner ${state.runner}`].filter(Boolean).join(" · ");
}

function hardMode(level) {
  return state.workbenchModes.get(Number(level))?.mode === "hard";
}

function hashPage() {
  const match = location.hash.match(/^#page=(\d+)$/);
  return match ? pageNumber(match[1]) : null;
}

function openPage(number) {
  if (!state.hero || state.switchingHero) return;
  const page = pageNumber(number);
  if (!page) return;
  const destination = state.total ? Math.min(page, state.total) : page;
  if (hashPage() === destination) {
    if (state.loading || state.page?.page !== destination || $("page-frame").hidden) loadPage(destination);
    return;
  }
  location.hash = `page=${destination}`;
}

let resumeWrites = Promise.resolve();
function saveReadingPosition(page) {
  const hero = state.hero;
  if (!hero) return;
  writeLocal(heroStorageKey(lastPageKey, hero), String(page));
  resumeWrites = resumeWrites.then(async () => {
    if (hero === state.hero && state.profile.lastPage === page) return;
    try {
      await api("/api/profile", { method: "PATCH", body: { lastPage: page }, hero });
      if (hero === state.hero) state.profile.lastPage = page;
    } catch {
      // The device copy still lets this browser reopen the current page.
    }
  });
}

function readerMessage(copy, loading, retry) {
  const placeholder = $("reader-placeholder");
  placeholder.replaceChildren();
  if (loading) {
    const mark = make("span", "loading-mark");
    mark.setAttribute("aria-hidden", "true");
    placeholder.append(mark);
  }
  placeholder.append(make("p", "", copy));
  if (retry) {
    const retryButton = button("Try again");
    retryButton.addEventListener("click", retry);
    placeholder.append(retryButton);
  }
  placeholder.hidden = false;
  $("page-frame").hidden = true;
}

function renderReaderControls() {
  const page = state.page?.page || 1;
  $("previous-page").disabled = state.loading || !state.page || page <= 1;
  $("next-page").disabled = state.loading || !state.page || page >= state.total;
  $("page-number").value = page;
  $("page-number").disabled = !state.hero;
  $("page-number").max = state.total || "";
  $("page-total").textContent = state.total ? `/ ${state.total}` : "/ …";
  $("zoom-out").disabled = state.zoom <= .65;
  $("zoom-in").disabled = state.zoom >= 1.85;
  $("zoom-fit").textContent = state.zoom === 1 ? "Fit" : `${Math.round(state.zoom * 100)}%`;
}

function layoutPage() {
  const viewport = $("reader-viewport");
  const style = getComputedStyle(viewport);
  const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const width = Math.max(120, Math.min(720, viewport.clientWidth - horizontalPadding));
  $("page-frame").style.width = `${Math.round(width * state.zoom)}px`;
}

function changeZoom(zoom) {
  state.zoom = Math.max(.65, Math.min(1.85, Math.round(zoom * 100) / 100));
  layoutPage();
  renderReaderControls();
}

function externalUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function pageImage(data) {
  const prefix = state.world.id === "rust" ? "/book/pages/" : `/book/${state.world.id}/pages/`;
  try {
    const url = new URL(data.image, location.origin);
    if (url.origin === location.origin && url.pathname.startsWith(prefix)) return url.href;
  } catch {
    // Use the standard page path when the response omits an image URL.
  }
  return `${prefix}${data.page}.webp`;
}

function renderHotspots(data) {
  const hotspots = $("page-hotspots");
  hotspots.replaceChildren();
  for (const link of list(data.links)) {
    const [x, y, width, height] = [link.x, link.y, link.w, link.h].map(Number);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    const target = pageNumber(link.page);
    const url = externalUrl(link.url);
    if ((!target || target > state.total) && !url) continue;
    const anchor = make("a", "page-hotspot");
    if (target && target <= state.total) {
      anchor.href = `#page=${target}`;
      anchor.setAttribute("aria-label", text(link.title) || `Open book page ${target}`);
    } else {
      anchor.href = url.href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.setAttribute("aria-label", text(link.title) || `Open ${url.hostname} in a new tab`);
    }
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    if (left >= 100 || top >= 100) continue;
    anchor.style.left = `${left}%`;
    anchor.style.top = `${top}%`;
    anchor.style.width = `${Math.min(width, 100 - left)}%`;
    anchor.style.height = `${Math.min(height, 100 - top)}%`;
    hotspots.append(anchor);
  }
}

async function loadPage(number) {
  const request = ++state.requestNumber;
  state.loading = true;
  readerMessage(`Opening page ${number}…`, true);
  $("guide-content").setAttribute("aria-busy", "true");
  renderReaderControls();
  try {
    const data = await api(`/api/pages/${number}`);
    if (request !== state.requestNumber) return;
    const page = pageNumber(data.page);
    const total = pageNumber(data.total);
    if (!page || !total || page > total) throw new Error("The book page metadata is incomplete.");
    state.page = { ...data, page };
    state.total = total;
    state.loading = false;
    saveReadingPosition(page);
    const quest = findQuest(data.level);
    const zone = zoneFor(Number(data.level));
    $("reader-location").textContent = quest && zone ? `${zone.name} · Level ${quest.level}`
      : text(data.title) || `Page ${page}`;
    const image = $("book-page");
    const bookName = state.world.id === "rust" ? "Ferrum campaign book" : `${state.world.name} campaign book`;
    image.alt = `${bookName}, page ${page}${data.title ? ` · ${text(data.title)}` : ""}`;
    image.onload = () => {
      if (request !== state.requestNumber) return;
      $("reader-placeholder").hidden = true;
      $("page-frame").hidden = false;
      layoutPage();
    };
    image.onerror = () => {
      if (request !== state.requestNumber) return;
      readerMessage(`The image for page ${page} could not be loaded.`, false, () => loadPage(page));
    };
    image.src = pageImage(state.page);
    if (image.complete && image.naturalWidth && image.currentSrc === image.src) image.onload();
    renderHotspots(state.page);
    renderReaderControls();
    renderGuide(state.page);
    $("reader-viewport").scrollTo(0, 0);
    $("guide-scroll").scrollTo(0, 0);
    if (matchMedia("(max-width: 800px)").matches) window.scrollTo(0, 0);
  } catch (error) {
    if (request !== state.requestNumber) return;
    state.loading = false;
    readerMessage(error.message, false, () => loadPage(number));
    $("guide-content").setAttribute("aria-busy", "false");
    if (!state.page) {
      const first = button("Open page one");
      first.addEventListener("click", () => openPage(1));
      $("guide-content").replaceChildren(make("p", "muted", "The guide is waiting for a book page."), first);
    }
    renderReaderControls();
  }
}

function section(title, className = "") {
  const card = make("section", `field-card${className ? ` ${className}` : ""}`);
  card.append(make("h2", "", title));
  return card;
}

function guideNotes(data) {
  const notes = typeof data.notes === "string" ? [data.notes] : list(data.notes);
  const paragraphs = notes.map((note) => text(note) || text(note?.body)).filter(Boolean);
  const card = make("section", "field-card note-card");
  const zone = zoneFor(Number(data.level));
  card.append(make("p", "eyebrow", zone ? `LEVEL ${data.level} · ${zone.name.toUpperCase()}` : "CAMPAIGN FIELD NOTES"));
  if (paragraphs.length) {
    for (const note of paragraphs) card.append(make("p", "", note));
  } else {
    card.append(make("p", "", data.level
      ? "Read this page, then follow an encounter or jump to another level from the world map."
      : "The book is your campaign map. Turn a page to continue, or open a level from the world map."));
  }
  if (data.page === 1 && levelPage(1)) {
    const actions = make("div", "hint-actions");
    actions.append(bookLink("Begin Level 01", levelPage(1), "button button-primary"));
    card.append(actions);
  }
  return card;
}

function routeSuggestion(data, correct, prompt, value) {
  const quest = findQuest(data.level);
  if (!quest) {
    const room = list(state.campaign.rooms).find((item) => `room-${item.id}` === prompt?.id);
    const optionIndex = list(prompt?.options).findIndex((option) => String(option.id) === String(value));
    const level = list(room?.choices)[optionIndex]?.level;
    const page = levelPage(level);
    return page ? bookLink(`Explore the consequence · Level ${level}`, page, "recommendation") : null;
  }
  const earlier = list(quest.loadout).filter((level) => levelPage(level));
  const later = list(quest.route_choices).find((route) => Number(route.level) > Number(data.level) && levelPage(route.level));
  const level = correct === false ? earlier.at(-1) : later?.level;
  const page = levelPage(level);
  if (!page) return null;
  const prefix = correct === false ? "Review" : text(later?.label) || "Continue";
  return bookLink(`${prefix} · Level ${level}`, page, "recommendation");
}

function answerFeedback(container, response, data, prompt) {
  container.replaceChildren();
  if (!response) {
    container.hidden = true;
    return;
  }
  if (prompt?.assessment) {
    const assessment = response.assessment;
    const scored = assessment?.status === "scored" && Number.isInteger(assessment.score);
    container.dataset.verdict = scored ? "correct" : "saved";
    container.append(make("strong", "feedback-heading", scored ? `${assessment.score}% of rubric points verified` : "Response saved"));
    if (text(assessment?.feedback)) container.append(make("p", "", assessment.feedback));
    if (!hardMode(data.level) || assessment?.score === 100) {
      const hero = state.hero;
      const reveal = button("Show example answer", "button button-quiet");
      reveal.addEventListener("click", async () => {
        reveal.disabled = true;
        try {
          const result = await api("/api/answers/reveal", {hero, method:"POST", body:{page:data.page, promptId:prompt.id}});
          if (hero === state.hero && container.isConnected && (!hardMode(data.level) || assessment?.score === 100)) {
            reveal.replaceWith(make("p", "example-answer", text(result.text)));
          }
        } catch (error) {
          if (hero === state.hero && container.isConnected) toast(error.message);
        } finally {
          reveal.disabled = false;
        }
      });
      container.append(reveal);
    }
    container.hidden = false;
    return;
  }
  const correct = response.correct == null ? null : enabled(response.correct);
  container.dataset.verdict = correct === null ? "saved" : correct ? "correct" : "incorrect";
  container.append(make("strong", "feedback-heading", correct === null ? "Response saved" : correct ? "Correct" : "Revisit this choice"));
  if (text(response.feedback)) container.append(make("p", "", response.feedback));
  if (prompt?.type === "choice") {
    const route = routeSuggestion(data, correct, prompt, response.value);
    if (route) container.append(route);
  }
  container.hidden = false;
}

function testPassed(result) {
  return ["pass", "passed", "success", "accepted"].includes(text(result.verdict).toLowerCase());
}

function testRecorded(result) {
  return testPassed(result) || ["fail", "compile_error", "timeout"].includes(text(result.verdict));
}

function testFeedback(container, result, data) {
  container.replaceChildren();
  if (!result) {
    container.hidden = true;
    return;
  }
  const passed = testPassed(result);
  const recorded = testRecorded(result);
  const verdict = text(result.verdict).replaceAll("_", " ").replaceAll("-", " ");
  container.dataset.verdict = passed ? "correct" : recorded ? "failed" : "saved";
  container.append(make("strong", "feedback-heading", passed ? (result.purpose === "examples" ? "Examples passed" : "Tests passed") : !recorded ? "Code draft saved"
    : verdict ? `Runner result · ${verdict}` : "Tests did not pass"));
  if (recorded && typeof result.passed === "number" && typeof result.failed === "number") {
    container.append(make("p", "", `${result.passed} passed · ${result.failed} failed`));
  }
  const timings = [Number.isFinite(result.compileMs) ? `Compile and check ${result.compileMs} ms` : "",
    Number.isFinite(result.runtimeMs) ? `Test runtime ${result.runtimeMs} ms` : "",
    Number.isFinite(result.elapsedMs) ? `Total runner time ${result.elapsedMs} ms` : ""].filter(Boolean);
  if (timings.length) container.append(make("p", "fine-print", timings.join(" · ")));
  if (list(result.groups).length) {
    const wards = make("ul", "workbench-wards");
    wards.setAttribute("aria-label", "Test wards");
    for (const group of result.groups) {
      const cleared = group.passed === group.required;
      const ward = make("li", "", `${text(group.group)} · ${group.passed}/${group.required}${cleared ? " cleared" : ""}`);
      ward.dataset.done = String(cleared);
      wards.append(ward);
    }
    container.append(wards);
  }
  for (const item of list(result.cases)) {
    const elapsed = Number.isFinite(item.durationMs) ? ` · ${item.durationMs} ms` : "";
    container.append(make("p", "fine-print", `${text(item.id)} · ${text(item.status)}${elapsed}${item.message ? ` · ${item.message}` : ""}`));
  }
  if (result.hardClear) container.append(badge("Hard Clear", true));
  if (text(result.output)) {
    if (!recorded) container.append(make("p", "", result.output));
    else {
      const details = make("details", "details-block");
      details.open = !passed;
      details.append(make("summary", "", "Compiler and test output"), make("pre", "test-output", result.output));
      container.append(details);
    }
  }
  if (passed && result.purpose !== "examples" && !hardMode(data.level)) {
    const route = routeSuggestion(data, true);
    if (route) container.append(route);
  }
  container.hidden = false;
}

function renderPrompt(data, prompt, index) {
  const hero = state.hero;
  const codePrompt = prompt.type === "code";
  const choicePrompt = prompt.type === "choice";
  const runnable = codePrompt && prompt.exerciseId != null;
  const form = make("form", "field-card prompt-form");
  const heading = make("div", "prompt-heading");
  const title = make("h2", "", text(prompt.title) || "Encounter");
  title.id = `prompt-title-${data.page}-${index}`;
  form.setAttribute("aria-labelledby", title.id);
  heading.append(title, make("span", "prompt-type", promptLabels[prompt.type]));
  form.append(heading);
  if (text(prompt.body)) form.append(make("p", "prompt-copy", prompt.body));
  const exercise = runnable ? findExercise(prompt.exerciseId) : null;
  if (exercise && text(exercise.description) && exercise.description !== prompt.body) {
    form.append(make("p", "prompt-copy", exercise.description));
  }
  if (text(exercise?.signature)) form.append(make("pre", "signature", exercise.signature));

  const key = responseKey(data.page, prompt.id);
  const saved = state.responses.get(key);
  const initial = state.drafts.get(key) ?? saved?.value ?? (codePrompt
    ? text(prompt.starter) || text(exercise?.starter) : "");
  let input;
  let valueOf;
  if (choicePrompt) {
    input = make("fieldset", "choice-group");
    input.append(make("legend", "visually-hidden", "Select one answer"));
    list(prompt.options).forEach((option, optionIndex) => {
      const label = make("label", "choice-option");
      const radio = make("input");
      radio.type = "radio";
      radio.name = `choice-${data.page}-${index}`;
      radio.value = String(option.id ?? optionIndex);
      radio.checked = radio.value === String(initial);
      radio.required = true;
      const letter = make("span", "choice-letter", String.fromCharCode(65 + optionIndex));
      letter.setAttribute("aria-hidden", "true");
      label.append(letter, make("span", "", text(option.text)), radio);
      input.append(label);
    });
    valueOf = () => input.querySelector("input:checked")?.value ?? "";
  } else {
    input = make("textarea", codePrompt ? "code-editor" : "answer-editor");
    input.setAttribute("aria-label", codePrompt ? `${state.world.name} code` : "Your written response");
    input.value = String(initial);
    input.rows = codePrompt ? 12 : 4;
    input.maxLength = codePrompt ? 49152 : 12000;
    input.placeholder = codePrompt ? `Write your ${state.world.name} solution here` : "Explain your reasoning and the rule you rely on.";
    input.spellcheck = !codePrompt;
    if (codePrompt) {
      input.autocapitalize = "off";
      input.autocomplete = "off";
      input.setAttribute("autocorrect", "off");
    }
    valueOf = () => input.value;
  }
  form.append(input);

  const criteria = list(prompt.criteria).filter((criterion) => text(criterion));
  if (criteria.length) {
    const details = make("details", "details-block");
    const checklist = make("ul");
    for (const criterion of criteria) checklist.append(make("li", "", criterion));
    details.append(make("summary", "", "Review criteria"), checklist);
    form.append(details);
  }

  const testNames = list(exercise?.testNames);
  if (testNames.length) {
    const details = make("details", "details-block");
    details.append(make("summary", "", `What the runner checks · ${testNames.length}`));
    const checks = make("ul");
    for (const name of testNames) checks.append(make("li", "", text(name)));
    details.append(checks);
    form.append(details);
  }

  const actions = make("div", "form-actions");
  const submit = button(runnable ? "Submit solution" : codePrompt ? "Save code notes" : choicePrompt ? "Check answer" : prompt.assessment ? "Ask the GM" : "Submit response", "button button-primary");
  submit.type = "submit";
  submit.disabled = runnable && state.runner.toLowerCase() === "unavailable";
  const status = make("span", "inline-status");
  status.setAttribute("aria-live", "polite");
  actions.append(submit);
  let saveCode;
  let examples;
  let cancel;
  let activeRun;
  if (runnable) {
    examples = button("Run Examples", "button button-quiet");
    examples.type = "submit";
    examples.disabled = submit.disabled;
    cancel = button("Cancel run", "button button-quiet");
    cancel.hidden = true;
    cancel.addEventListener("click", () => activeRun?.abort());
    actions.append(examples, cancel);
    saveCode = button("Save draft", "button button-quiet");
    saveCode.addEventListener("click", async () => {
      if (hero !== state.hero || state.switchingHero) return;
      const value = valueOf();
      const wasDisabled = submit.disabled;
      saveCode.disabled = true;
      submit.disabled = true;
      examples.disabled = true;
      input.disabled = true;
      setInlineStatus(status, "Saving…");
      try {
        const result = await api("/api/answers", {
          method: "POST", body: { page: data.page, promptId: prompt.id, value },
        });
        if (hero !== state.hero) return;
        state.responses.set(key, { ...result, page: data.page, promptId: prompt.id, value });
        clearDraft(key, value);
        setInlineStatus(status, "Draft saved");
      } catch (error) {
        if (hero === state.hero) setInlineStatus(status, error.message, true);
      } finally {
        if (hero === state.hero) {
          saveCode.disabled = false;
          submit.disabled = wasDisabled;
          examples.disabled = wasDisabled;
          input.disabled = false;
        }
      }
    });
    actions.append(saveCode);
  }
  actions.append(status);
  form.append(actions);
  if (codePrompt && !runnable) {
    form.append(make("p", "fine-print", "This is a code notebook. Your notes are saved for this page."));
  } else if (submit.disabled) {
    form.append(make("p", "fine-print", `The local ${state.world.name} runner is unavailable. You can still save your code draft.`));
  }
  const feedback = make("div", "prompt-feedback");
  feedback.setAttribute("aria-live", "polite");
  form.append(feedback);
  if (runnable) {
    const attempt = state.attempts.find((item) => String(item.exerciseId) === String(prompt.exerciseId)
      && (!item.page || Number(item.page) === data.page));
    if (attempt) testFeedback(feedback, attempt, data);
    else answerFeedback(feedback, saved, data, prompt);
  } else {
    answerFeedback(feedback, saved, data, prompt);
  }

  input.addEventListener("input", () => {
    if (hero !== state.hero || state.switchingHero) return;
    const kept = persistDraft(key, valueOf());
    setInlineStatus(status, kept ? "Draft kept on this device" : "Draft kept in this tab");
  });
  form.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !submit.disabled) {
      event.preventDefault();
      form.requestSubmit(submit);
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled || hero !== state.hero || state.switchingHero) return;
    const value = valueOf();
    if (!value.trim()) {
      setInlineStatus(status, choicePrompt ? "Choose an answer first." : "Enter a response first.", true);
      return;
    }
    persistDraft(key, value);
    submit.disabled = true;
    if (examples) examples.disabled = true;
    if (saveCode) saveCode.disabled = true;
    input.disabled = true;
    const purpose = examples && event.submitter === examples ? "examples" : "submit";
    setInlineStatus(status, runnable ? "Compiling and testing…" : prompt.assessment ? "The GM is reviewing…" : "Saving response…");
    try {
      if (runnable) {
        activeRun = new AbortController();
        cancel.hidden = false;
        const result = await api("/api/grade", {
          method: "POST",
          body: { page: data.page, promptId: prompt.id, exerciseId: prompt.exerciseId, code: value, purpose },
          signal: activeRun.signal,
        });
        if (hero !== state.hero) return;
        clearDraft(key, value);
        testFeedback(feedback, result, data);
        const recorded = testRecorded(result);
        setInlineStatus(status, purpose === "examples" && recorded ? "Practice run complete" : recorded ? "Test run recorded" : "Draft saved. No result was recorded.");
        try {
          await refreshProgress({ animateForgeLevel: purpose === "submit" && testPassed(result) && result.newClear !== false ? Number(data.level) : null });
        } catch {
          if (recorded && hero === state.hero) setInlineStatus(status, "Test run recorded. Refresh the quest log to update your badges.");
        }
      } else {
        const result = await api("/api/answers", { method: "POST", body: { page: data.page, promptId: prompt.id, value } });
        if (hero !== state.hero) return;
        const response = { ...result, page: data.page, promptId: prompt.id, value };
        state.responses.set(key, response);
        clearDraft(key, value);
        answerFeedback(feedback, response, data, prompt);
        setInlineStatus(status, "Saved to your quest log");
      }
    } catch (error) {
      if (hero === state.hero) setInlineStatus(status, activeRun?.signal.aborted ? "Run canceled. Your draft is kept." : error.message, !activeRun?.signal.aborted);
    } finally {
      activeRun = null;
      if (cancel) cancel.hidden = true;
      if (hero === state.hero) {
        submit.disabled = runnable && state.runner.toLowerCase() === "unavailable";
        if (examples) examples.disabled = submit.disabled;
        if (saveCode) saveCode.disabled = false;
        input.disabled = false;
      }
    }
  });
  return form;
}

function renderHints(data) {
  const hero = state.hero;
  if (!pageNumber(data.level) || (hardMode(data.level) && !enabled(state.levels.get(Number(data.level))?.forge))) return null;
  const hints = data.hintKinds === undefined ? ["hint1", "hint2"] : list(data.hintKinds);
  const kinds = hints.filter((kind) => Object.hasOwn(hintLabels, kind));
  if (!kinds.length) return null;
  const card = section("Guide kit");
  const actions = make("div", "hint-actions");
  const panel = make("div", "hint-body");
  panel.hidden = true;
  panel.id = "hint-panel";
  panel.setAttribute("aria-live", "polite");
  let selected = "";
  let request = 0;
  for (const kind of kinds) {
    const control = button(hintLabels[kind], "button button-quiet");
    control.setAttribute("aria-expanded", "false");
    control.setAttribute("aria-controls", panel.id);
    control.addEventListener("click", async () => {
      const number = ++request;
      const hide = selected === kind && !panel.hidden;
      selected = hide ? "" : kind;
      for (const item of actions.children) item.setAttribute("aria-expanded", "false");
      panel.hidden = hide;
      if (hide) return;
      control.setAttribute("aria-expanded", "true");
      panel.replaceChildren(make("p", "muted", "Opening the guide kit…"));
      try {
        const result = await api(`/api/levels/${data.level}/reveal/${kind}`, {hero});
        if (number === request && hero === state.hero && panel.isConnected && (!hardMode(data.level)
            || enabled(state.levels.get(Number(data.level))?.forge))) {
          panel.replaceChildren(make("p", "", text(result.text) || "No guide note is available here."));
        }
      } catch (error) {
        if (number === request && hero === state.hero) panel.replaceChildren(make("p", "", error.message));
      }
    });
    actions.append(control);
  }
  card.append(actions, panel);
  return card;
}

function renderDifficulty(data) {
  const level = pageNumber(data.level);
  const hero = state.hero;
  if (!level || !list(data.prompts).some(prompt => prompt.exerciseId || prompt.assessment)) return null;
  const card = section("Encounter difficulty");
  const hard = hardMode(level);
  const status = make("p", "fine-print", hard ? "Coaching is locked for this encounter." : "Hints and example answers are available on request.");
  const change = button(hard ? "Switch to Guided" : "Hard Mode", "button button-quiet");
  change.addEventListener("click", async () => {
    change.disabled = true;
    try {
      const mode = await api(`/api/workbench/${level}/mode`, {hero, method:"PATCH", body:{mode:hard ? "guided" : "hard"}});
      if (hero !== state.hero) return;
      state.workbenchModes.set(level, mode);
      if (data.page !== state.page?.page) return;
      if (mode.mode === "hard") {
        for (const prompt of list(data.prompts).filter(prompt => prompt.assessment)) {
          const saved = state.responses.get(responseKey(data.page, prompt.id));
          if (saved?.assessment) {
            const {status:assessmentStatus, score} = saved.assessment;
            saved.assessment = {status:assessmentStatus, score, feedback:"Hard Mode review saved."};
          }
        }
      }
      renderGuide(data);
      await refreshProgress();
      if (hero === state.hero && data.page === state.page?.page && mode.mode === "guided") renderGuide(data);
    } catch (error) {
      if (hero === state.hero) toast(error.message);
    } finally {
      change.disabled = false;
    }
  });
  card.append(status, change);
  return card;
}

function badge(label, done) {
  const item = make("span", "badge", label);
  item.dataset.done = String(Boolean(done));
  return item;
}

function updateForgeBadge() {
  const marker = $("forge-marker");
  const level = Number(state.page?.level);
  if (!marker || !level) return;
  const forged = enabled(state.levels.get(level)?.forge);
  marker.dataset.done = String(forged);
  marker.textContent = forged ? "Forge earned" : "Forge · pass the tests";
}

function clearGuideEncounters() {
  state.creature?.destroy();
  state.creature = null;
  state.specialEncounter?.destroy();
  state.specialEncounter = null;
}

function updateCreature(animateLevel = null) {
  const encounter = state.creature;
  if (!encounter) return;
  encounter.update(enabled(state.levels.get(encounter.level)?.forge), {
    animate: !state.loading && encounter.level === animateLevel,
  });
}

function creatureEncounter(data, quest) {
  const isBoss = data.page === Number(quest.bossPage);
  const isGraded = list(data.prompts).some((prompt) => prompt.exerciseId);
  if (!isBoss && !isGraded) return null;

  const world = state.world.id;
  const level = Number(quest.level);
  const card = make("section", "field-card creature-encounter");
  const heading = make("div", "creature-heading");
  const identity = make("div");
  identity.append(make("p", "eyebrow", "DUNGEON ENCOUNTER"), make("h2", "", creatureName(world, level)));
  const status = make("p", "creature-status");
  status.setAttribute("role", "status");
  heading.append(identity, status);
  const canvas = make("canvas");
  canvas.width = 320;
  canvas.height = 116;
  canvas.setAttribute("aria-hidden", "true");
  card.append(heading, canvas);

  const drillPage = pageNumber(levelExercises(level)[0]?.page);
  if (isGraded) {
    card.append(make("p", "fine-print", "Pass the challenge tests to defeat this creature."));
  } else if (drillPage) {
    const hint = make("p", "fine-print");
    hint.append(bookLink("Open the graded drill", drillPage), " to defeat this creature.");
    card.append(hint);
  } else {
    card.append(make("p", "fine-print", "Save your challenge draft and complete Forge self-review below."));
  }

  const renderer = mountCreature(canvas, {
    world,
    level,
    defeated: enabled(state.levels.get(level)?.forge),
    onStateChange(phase) {
      card.dataset.state = phase;
      const copy = phase === "ready" ? "Awaiting Forge" : "Defeated · Forge earned";
      if (status.textContent !== copy) status.textContent = copy;
      if (phase === "defeating" && card.isConnected) card.scrollIntoView({ block: "nearest" });
    },
  });
  state.creature = { ...renderer, level };
  return card;
}

function levelCheckpoint(data, quest) {
  const hero = state.hero;
  const card = section("Level checkpoint");
  const level = Number(quest.level);
  const record = state.levels.get(level) || {};
  const checkpoints = make("div", "checkpoint-list");
  const fields = [["scout", "Scouted"], ["explain", "Explained"], ["side", "Side quest done"]];
  const hasTests = levelExercises(level).length > 0;
  if (!hasTests && !state.campaignError) fields.push(["forge", "Forge self-review"]);
  for (const [field, label] of fields) {
    const item = make("label");
    const input = make("input");
    input.type = "checkbox";
    input.checked = enabled(record[field]);
    input.addEventListener("change", async () => {
      if (hero !== state.hero || state.switchingHero) return;
      const checked = input.checked;
      input.disabled = true;
      try {
        await api(`/api/progress/${level}`, { method: "PATCH", body: { [field]: checked } });
        if (hero !== state.hero) return;
        state.levels.set(level, { ...state.levels.get(level), level, [field]: checked });
        if (field === "forge") updateCreature(level);
        toast("Quest log updated");
      } catch (error) {
        if (hero === state.hero) {
          input.checked = !checked;
          toast(error.message);
        }
      } finally {
        if (hero === state.hero) input.disabled = false;
      }
    });
    item.append(input, make("span", "", label));
    checkpoints.append(item);
  }
  if (hasTests) {
    const forged = enabled(record.forge);
    const marker = badge(forged ? "Forge earned" : "Forge · pass the tests", forged);
    marker.id = "forge-marker";
    checkpoints.append(marker);
  }
  card.append(checkpoints);
  if (text(quest.side_quest) || list(quest.route_choices).length) {
    const details = make("details", "details-block hint-actions");
    details.style.display = "block";
    details.open = Number(quest.sidePage) === data.page || data.kind === "side";
    details.append(make("summary", "", "Side quest and exits"));
    if (text(quest.side_quest)) details.append(make("p", "", quest.side_quest));
    const routes = make("div", "route-links");
    for (const route of list(quest.route_choices)) {
      const page = levelPage(route.level);
      if (!page) continue;
      const link = bookLink(`${text(route.label)} · Level ${route.level}`, page, "route-link");
      if (text(route.reason)) link.append(make("span", "", route.reason));
      routes.append(link);
    }
    details.append(routes);
    card.append(details);
  }
  return card;
}

function renderGuide(data) {
  const hero = state.hero;
  const guide = $("guide-content");
  const quest = findQuest(data.level);
  clearGuideEncounters();
  $("guide-title").textContent = text(data.title) || text(quest?.mission_title) || `Book page ${data.page}`;
  const content = [guideNotes(data)];
  if (state.progressError) {
    const status = section("Quest log connection");
    status.append(make("p", "muted", "Saved progress could not be loaded. Your current draft stays available in this tab."));
    const refresh = button("Refresh progress");
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      try {
        await refreshProgress();
        if (hero === state.hero && state.page?.page === data.page) renderGuide(data);
      } catch (error) {
        if (hero === state.hero) {
          toast(error.message);
          refresh.disabled = false;
        }
      }
    });
    status.append(refresh);
    content.push(status);
  }
  const special = list(state.campaign.specialEncounters).find((item) => item.page === data.page);
  if (special && hero) {
    const endpoint = `/api/encounters/${encodeURIComponent(special.id)}`;
    state.specialEncounter = createSpecialEncounter(special, {
      load: () => api(endpoint, { hero }),
      submit: (body) => api(endpoint, { hero, method: "POST", body }),
    });
    content.push(state.specialEncounter.card);
  }
  const encounter = quest && creatureEncounter(data, quest);
  if (encounter) content.push(encounter);
  const difficulty = renderDifficulty(data);
  if (difficulty) content.push(difficulty);
  list(data.prompts).forEach((prompt, index) => {
    if (Object.hasOwn(promptLabels, prompt.type) && prompt.id != null) content.push(renderPrompt(data, prompt, index));
  });
  const hints = renderHints(data);
  if (hints) content.push(hints);
  if (quest) content.push(levelCheckpoint(data, quest));
  guide.replaceChildren(...content);
  guide.setAttribute("aria-busy", "false");
  state.specialEncounter?.start();
}

function populatePaths() {
  for (const [id, initial] of [["map-path", "All paths"], ["path-input", "Explore freely"], ["hero-path", "Explore freely"]]) {
    const select = $(id);
    const first = make("option", "", initial);
    first.value = "";
    select.replaceChildren(first);
    for (const path of list(state.campaign.paths)) {
      const option = make("option", "", text(path.name));
      option.value = String(path.id);
      select.append(option);
    }
  }
  $("map-path").value = state.profile.path;
}

function renderPathPreview(preview, path) {
  if (!path) {
    const count = list(state.campaign.quests).length;
    preview.replaceChildren(make("p", "", `Explore freely through all ${count} levels. You can pick a path later.`));
    return;
  }
  const title = make("p", "path-summary-heading");
  title.append(make("strong", "", text(path.name)), make("span", "", `${list(path.levels).length} levels`));
  preview.replaceChildren(title, make("p", "", text(path.description)));
  const topics = text(path.topics) || pathTopics.get(path.id);
  if (topics) {
    const coverage = make("p");
    coverage.append(make("strong", "path-summary-label", "What you’ll cover"), " ", topics);
    preview.append(coverage);
  }
}

async function saveProfile(callsign, path) {
  const hero = state.hero;
  const result = await api("/api/profile", { method: "PATCH", body: { callsign, path } });
  if (hero !== state.hero) return false;
  state.profile = {
    ...state.profile,
    callsign: text(result.hero?.name) || callsign || "Explorer",
    path: result.hero?.path === "all" ? "" : text(result.hero?.path) || path,
  };
  hero.name = state.profile.callsign;
  $("header-callsign").textContent = state.profile.callsign;
  $("map-path").value = state.profile.path;
  return true;
}

function renderMap() {
  const destination = $("map-levels");
  const description = $("map-description");
  destination.replaceChildren();
  description.replaceChildren();
  if (state.campaignError) {
    destination.append(make("p", "muted", `The world map could not load. ${state.campaignError}`));
    return;
  }
  const pathId = $("map-path").value;
  const path = list(state.campaign.paths).find((item) => item.id === pathId);
  if (path) {
    const hero = state.hero;
    const summary = make("div", "path-summary");
    renderPathPreview(summary, path);
    const equip = button(state.profile.path === pathId ? "Current path" : "Choose this path");
    equip.disabled = state.profile.path === pathId;
    equip.addEventListener("click", async () => {
      equip.disabled = true;
      try {
        if (!await saveProfile(state.profile.callsign, pathId)) return;
        renderMap();
        toast(`${path.name} equipped`);
      } catch (error) {
        if (hero === state.hero) {
          equip.disabled = false;
          toast(error.message);
        }
      }
    });
    summary.append(equip);
    description.append(summary);
  }
  const specials = list(state.campaign.specialEncounters);
  if (specials.length) {
    const group = make("section", "special-map");
    group.append(make("h3", "zone-title", "Special encounters"));
    for (const special of specials) {
      const entry = make("div", "special-map-entry");
      const link = bookLink(special.title, special.page);
      link.addEventListener("click", () => $("map-dialog").close());
      entry.append(link, make("span", "fine-print", `${encounterKind(special)} · Level ${special.level}`));
      group.append(entry);
    }
    description.append(group);
  }
  const filter = $("map-search").value.trim().toLowerCase();
  const pathLevels = new Set(list(path?.levels).map(Number));
  for (const [index, zone] of campaignZones().entries()) {
    const candidates = list(state.campaign.quests).filter((quest) => {
      const level = Number(quest.level);
      const title = `${level} ${String(level).padStart(2, "0")} level ${level} ${text(quest.mission_title)}`.toLowerCase();
      return level >= zone.first && level <= zone.last && (!path || pathLevels.has(level)) && title.includes(filter);
    });
    if (!candidates.length) continue;
    const group = make("section", "map-zone");
    group.append(make("h3", "zone-title", `Zone ${index + 1} · ${zone.name}`));
    for (const quest of candidates) {
      const level = Number(quest.level);
      const page = levelPage(level);
      const item = page ? bookLink("", page, "map-level") : make("div", "map-level");
      if (level === Number(state.page?.level)) item.setAttribute("aria-current", "page");
      const record = state.levels.get(level);
      const checkpoints = [record?.scout, record?.forge, record?.explain];
      const completed = checkpoints.every(enabled);
      const started = checkpoints.some(enabled) || enabled(record?.side);
      const pageLabel = make("span", "map-page", completed ? "Cleared" : started ? "Started" : page ? `p. ${page}` : "Unavailable");
      pageLabel.dataset.complete = String(completed);
      item.append(make("span", "map-number", String(level).padStart(2, "0")), make("span", "", text(quest.mission_title)), pageLabel);
      if (page) item.addEventListener("click", () => $("map-dialog").close());
      group.append(item);
    }
    destination.append(group);
  }
  if (!destination.children.length) destination.append(make("p", "muted", "No levels match this search."));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function progressMeter(value, total, label) {
  const meter = make("progress", "sheet-meter");
  meter.max = Math.max(1, total);
  meter.value = value;
  meter.setAttribute("aria-label", label);
  return meter;
}

function renderCharacterSheet() {
  const log = $("log-content");
  const rulesOpen = log.querySelector("details")?.open;
  const progress = characterProgress(
    { ...state.campaign, zones: campaignZones() }, state.levels, state.profile.path,
  );
  const { heroLevel, heroLevelCap, xp, xpMax, nextLevelXp, counts, route } = progress;
  const hero = make("div", "sheet-hero");
  const identity = make("div", "sheet-identity");
  const name = make("div", "sheet-name");
  name.append(
    make("p", "eyebrow", state.world.name),
    make("h3", "", state.profile.callsign),
    make("p", "fine-print", route?.name || "Open expedition"),
  );
  identity.append(name, make("strong", "sheet-level", `Hero level ${heroLevel} / ${heroLevelCap}`));
  const xpDetail = make("div", "sheet-line");
  xpDetail.append(make("strong", "", `${xp} / ${xpMax} XP`), make("span", "fine-print",
    nextLevelXp === null ? (xpMax ? "Max hero level" : "No checkpoints yet") : `${nextLevelXp - xp} XP to level ${heroLevel + 1}`));
  hero.append(identity, xpDetail, progressMeter(xp, xpMax, "World experience"));
  const milestones = make("div", "sheet-milestones");
  milestones.append(make("p", "", `World: ${progress.completed} of ${progress.total} levels complete`));
  if (route) milestones.append(make("p", "", `Active path: ${route.completed} of ${route.total} levels complete`));
  hero.append(milestones);
  log.replaceChildren(hero);
  if (state.progressError) log.append(make("p", "muted", state.progressError));

  const stats = make("div", "stat-grid");
  for (const [mark, label] of [["scout", "Scout"], ["forge", "Forge"], ["explain", "Explain"], ["side", "Side quests"]]) {
    const stat = make("div", "stat-tile");
    stat.append(make("strong", "", String(counts[mark])), make("span", "", label));
    stats.append(stat);
  }
  if (state.hardClears.size) {
    const stat = make("div", "stat-tile");
    stat.append(make("strong", "", String(state.hardClears.size)), make("span", "", "Hard Clears"));
    stats.append(stat);
  }
  const skills = make("ul", "sheet-skills");
  for (const skill of progress.skills) {
    const item = make("li", "sheet-skill");
    const title = make("div", "sheet-line");
    title.append(make("strong", "", skill.name), make("span", "sheet-rank", `Level ${skill.level} / ${SKILL_LEVEL_CAP}`));
    item.append(title, progressMeter(skill.earned, skill.total, `${skill.name} checkpoint marks`),
      make("p", "fine-print", `${skill.earned} of ${skill.total} marks`));
    skills.append(item);
  }
  const rules = make("details", "sheet-rules");
  rules.open = Boolean(rulesOpen);
  rules.append(make("summary", "", "How progression works"), make("p", "",
    "Each Scout, Forge, or Explain mark gives 1 XP. Earn all three to complete a level. Hero levels track XP across this world, and each fifth of a skill’s marks raises that skill by one level. Side quests have their own tally. These levels reflect your in-game checkpoints."));
  if (state.world.id === "rust") {
    rules.append(make("p", "", "The printable Rust quest journal uses its own tabletop XP rules."));
  }
  log.append(stats, make("h3", "log-content-heading", "Skill levels"), skills, rules,
    make("h3", "log-content-heading", "Quest log"));
  const levels = make("div", "log-list");
  for (const [level, record] of [...state.levels.entries()].sort(([a], [b]) => a - b)) {
    if (![record.scout, record.forge, record.explain, record.side].some(enabled)) continue;
    const item = make("div", "log-entry");
    const title = `Level ${level} · ${text(findQuest(level)?.mission_title)}`;
    const page = levelPage(level);
    if (page) {
      const link = bookLink(title, page);
      link.addEventListener("click", () => $("log-dialog").close());
      item.append(link);
    } else item.append(make("p", "", title));
    const badges = make("div", "log-badges");
    for (const [field, label] of [["scout", "Scout"], ["forge", "Forge"], ["explain", "Explain"], ["side", "Side quest"]]) {
      if (enabled(record[field])) badges.append(badge(label, true));
    }
    if (state.hardClears.has(level)) badges.append(badge("Hard Clear", true));
    item.append(badges);
    levels.append(item);
  }
  if (!levels.children.length) levels.append(make("p", "muted", "Your level checkpoints will appear here."));
  log.append(levels);
  if (!list(state.campaign.exercises).length) return;
  log.append(make("h3", "log-content-heading", `Recent ${state.world.name} runs`));
  const attempts = make("div", "log-list");
  for (const attempt of state.attempts.slice(0, 10)) {
    const item = make("div", "log-entry");
    const exercise = findExercise(attempt.exerciseId);
    item.append(make("strong", "", text(exercise?.title) || `Level ${attempt.level}`));
    item.append(make("p", "fine-print", [text(attempt.verdict), formatDate(attempt.createdAt)].filter(Boolean).join(" · ")));
    const page = pageNumber(attempt.page);
    if (page) {
      const link = bookLink(`Return to page ${page}`, page);
      link.addEventListener("click", () => $("log-dialog").close());
      item.append(link);
    }
    attempts.append(item);
  }
  if (!attempts.children.length) attempts.append(make("p", "muted", `No ${state.world.name} test runs yet.`));
  log.append(attempts);
}

function showPathDescription(selectId, descriptionId) {
  const selected = list(state.campaign.paths).find((path) => path.id === $(selectId).value);
  renderPathPreview($(descriptionId), selected);
}

function openProfile() {
  if (!state.hero) return;
  $("callsign-input").value = state.profile.callsign;
  $("path-input").value = state.profile.path;
  showPathDescription("path-input", "profile-path-description");
  setInlineStatus($("profile-feedback"), "");
  $("profile-dialog").showModal();
}

function selectedHeroStorageKey() {
  return !state.world || state.world.id === "rust" ? selectedHeroKey : `${selectedHeroKey}:${state.world.id}`;
}

function tabHeroId() {
  try {
    return sessionStorage.getItem(selectedHeroStorageKey());
  } catch {
    return null;
  }
}

function rememberTabHero(id) {
  try {
    if (id) sessionStorage.setItem(selectedHeroStorageKey(), id);
    else sessionStorage.removeItem(selectedHeroStorageKey());
  } catch {
    // The selected hero still remains active for this page session.
  }
}

async function activateHero(selected, preferredPage = null) {
  if (!text(selected?.id)) throw new Error("The server did not return a hero save slot.");
  clearTimeout(toastTimer);
  $("toast").hidden = true;
  state.ready = false;
  state.requestNumber++;
  state.progressRequest++;
  state.hero = { ...selected };
  state.profile = {
    callsign: text(selected.name) || "Explorer",
    path: selected.path === "all" ? "" : text(selected.path),
    lastPage: pageNumber(selected.lastPage),
  };
  state.levels = new Map();
  state.responses = new Map();
  state.attempts = [];
  state.drafts = readDrafts(state.hero);
  state.workbenchModes = new Map();
  state.hardClears = new Set();
  state.progressError = "";
  state.page = null;
  state.loading = false;
  clearGuideEncounters();
  $("map-search").value = "";
  $("log-content").replaceChildren();
  $("guide-content").replaceChildren(make("p", "muted", "Opening your expedition…"));
  $("guide-title").textContent = state.profile.callsign;
  $("header-callsign").textContent = state.profile.callsign;
  readerMessage("Opening your expedition…", true);
  renderReaderControls();
  rememberTabHero(selected.id);

  try {
    await refreshProgress();
  } catch {
    // The guide displays the progress error and provides a refresh action.
  }
  $("map-path").value = state.profile.path;
  const rememberedPage = pageNumber(readLocal(heroStorageKey(lastPageKey, state.hero)));
  const requestedPage = preferredPage || rememberedPage || state.profile.lastPage || 1;
  const page = state.total ? Math.min(requestedPage, state.total) : requestedPage;
  history.replaceState(null, "", `#page=${page}`);
  state.ready = true;
  await loadPage(page);
}

function setHeroPickerBusy(busy) {
  state.switchingHero = busy;
  const controls = $("hero-form").elements;
  for (const control of controls) control.disabled = busy;
  for (const control of $("hero-list").querySelectorAll("button")) {
    control.disabled = busy || control.dataset.heroId === state.hero?.id;
  }
  $("close-heroes").disabled = busy;
  $("edit-active-hero").disabled = busy;
}

async function selectHero(endpoint, body, preferredPage = null) {
  if (state.switchingHero) return;
  setHeroPickerBusy(true);
  setInlineStatus($("hero-feedback"), "Opening your expedition…");
  try {
    const result = await api(endpoint, { method: "POST", body });
    await activateHero(result.hero, preferredPage);
    $("hero-dialog").close();
    $("hero-form").reset();
    $("reader-viewport").focus({ preventScroll: true });
  } catch (error) {
    setInlineStatus($("hero-feedback"), error.message, true);
  } finally {
    setHeroPickerBusy(false);
  }
}

async function refreshHeroList() {
  const request = ++state.heroListRequest;
  const container = $("hero-list");
  container.replaceChildren(make("p", "muted", "Loading saved heroes…"));
  try {
    const result = await api("/api/heroes");
    if (request !== state.heroListRequest || !$("hero-dialog").open) return;
    const heroes = list(result.heroes);
    state.heroCount = heroes.length;
    container.replaceChildren();
    for (const hero of heroes) {
      if (!text(hero.id)) continue;
      const name = text(hero.name) || "Explorer";
      const active = hero.id === state.hero?.id;
      const path = list(state.campaign.paths).find((item) => item.id === hero.path);
      const control = button("", "button hero-slot");
      control.dataset.heroId = hero.id;
      control.disabled = state.switchingHero || active;
      const mark = make("span", "profile-mark", [...name][0].toUpperCase());
      mark.setAttribute("aria-hidden", "true");
      const copy = make("span", "hero-slot-copy");
      const page = pageNumber(hero.lastPage) || 1;
      copy.append(make("strong", "", name), make("span", "hero-slot-meta",
        [`Page ${page}`, text(path?.name) || "Open expedition", active && "Current hero"].filter(Boolean).join(" · ")));
      control.append(mark, copy);
      control.addEventListener("click", () => selectHero("/api/heroes/load", { id: hero.id }));
      container.append(control);
    }
    if (!container.children.length) {
      container.append(make("p", "muted", "Your saved heroes will appear here."));
      if (!state.switchingHero) $("hero-name").focus();
    }
  } catch (error) {
    if (request !== state.heroListRequest || !$("hero-dialog").open) return;
    const retry = button("Try again");
    retry.addEventListener("click", refreshHeroList);
    container.replaceChildren(make("p", "muted", error.message), retry);
  }
}

function openHeroPicker() {
  if ($("hero-dialog").open) return;
  $("close-heroes").hidden = !state.hero;
  $("edit-active-hero").hidden = !state.hero;
  setInlineStatus($("hero-feedback"), "");
  showPathDescription("hero-path", "hero-path-description");
  $("hero-dialog").showModal();
  refreshHeroList();
}

function pageDirection(event) {
  if (event.key === "ArrowLeft" || event.code === "KeyA") return -1;
  if (event.key === "ArrowRight" || event.code === "KeyD") return 1;
  if (!event.code || event.code === "Unidentified") {
    const key = text(event.key).toLowerCase();
    if (key === "a") return -1;
    if (key === "d") return 1;
  }
  return 0;
}

function bindControls() {
  $("guide-panel").tabIndex = -1;
  $("open-worlds").addEventListener("click", openWorldPicker);
  $("hero-worlds").addEventListener("click", openWorldPicker);
  $("world-dialog").addEventListener("cancel", (event) => {
    if (!state.world) event.preventDefault();
  });
  $("world-dialog").addEventListener("close", () => {
    if (state.world && !state.hero) openHeroPicker();
  });
  $("previous-page").addEventListener("click", () => openPage(state.page.page - 1));
  $("next-page").addEventListener("click", () => openPage(state.page.page + 1));
  $("page-jump").addEventListener("submit", (event) => {
    event.preventDefault();
    openPage($("page-number").value);
  });
  $("zoom-out").addEventListener("click", () => changeZoom(state.zoom - .15));
  $("zoom-in").addEventListener("click", () => changeZoom(state.zoom + .15));
  $("zoom-fit").addEventListener("click", () => changeZoom(1));
  $("open-map").addEventListener("click", () => {
    if (!state.hero) return;
    renderMap();
    $("map-dialog").showModal();
  });
  $("open-log").addEventListener("click", () => {
    if (!state.hero) return;
    renderCharacterSheet();
    $("log-dialog").showModal();
    refreshProgress().catch((error) => toast(error.message));
  });
  $("open-profile").addEventListener("click", openProfile);
  $("open-heroes").addEventListener("click", openHeroPicker);
  $("edit-active-hero").addEventListener("click", () => {
    $("hero-dialog").close();
    openProfile();
  });
  $("hero-dialog").addEventListener("cancel", (event) => {
    if (!state.hero || state.switchingHero) event.preventDefault();
  });
  $("hero-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("hero-name").value.trim();
    if (!name) {
      setInlineStatus($("hero-feedback"), "Enter a hero name.", true);
      $("hero-name").focus();
      return;
    }
    const path = $("hero-path").value;
    const preferredPage = !state.hero && state.heroCount === 0 ? hashPage() : null;
    selectHero("/api/heroes", { name, path }, preferredPage);
  });
  $("map-search").addEventListener("input", renderMap);
  $("map-path").addEventListener("change", renderMap);
  $("hero-path").addEventListener("change", () => showPathDescription("hero-path", "hero-path-description"));
  $("path-input").addEventListener("change", () => showPathDescription("path-input", "profile-path-description"));
  $("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const hero = state.hero;
    const submit = event.currentTarget.querySelector("button[type=submit]");
    const callsign = $("callsign-input").value.trim() || "Explorer";
    const path = $("path-input").value;
    submit.disabled = true;
    setInlineStatus($("profile-feedback"), "Saving…");
    try {
      if (!await saveProfile(callsign, path)) return;
      $("profile-dialog").close();
      toast("Explorer profile saved");
    } catch (error) {
      if (hero === state.hero) setInlineStatus($("profile-feedback"), error.message, true);
    } finally {
      submit.disabled = false;
    }
  });
  for (const control of document.querySelectorAll("[data-close-dialog]")) {
    control.addEventListener("click", () => control.closest("dialog").close());
  }
  window.addEventListener("hashchange", () => {
    const page = hashPage();
    if (state.ready && !state.switchingHero && page && (state.loading || page !== state.page?.page)) loadPage(page);
  });
  window.addEventListener("resize", layoutPage);
  document.addEventListener("keydown", (event) => {
    if (!state.page || state.loading || state.switchingHero || event.defaultPrevented || event.isComposing
      || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || document.querySelector("dialog[open]") || event.target.isContentEditable
      || event.target.closest?.("input, textarea, select, [role=textbox], [role=combobox], [role=radio], [role=slider]")) return;
    const direction = pageDirection(event);
    const destination = state.page.page + direction;
    if (!direction || destination < 1 || destination > state.total) return;
    event.preventDefault();
    openPage(destination);
  });
}

function openWorldPicker() {
  const dialog = $("world-dialog");
  if (dialog.open) return;
  if ($("hero-dialog").open) $("hero-dialog").close();
  $("close-worlds").hidden = !state.world;
  const choices = $("world-list");
  choices.replaceChildren();
  for (const world of state.worlds) {
    const card = make("a", "world-card");
    card.href = `?world=${encodeURIComponent(world.id)}`;
    card.dataset.world = world.id;
    if (world.id === state.world?.id) card.setAttribute("aria-current", "true");
    card.append(make("span", "world-card-number", `World ${world.number}`),
      make("strong", "world-card-title", world.name),
      make("span", "world-card-copy", world.subtitle));
    choices.append(card);
  }
  if (!choices.children.length) {
    const retry = button("Retry loading worlds");
    retry.addEventListener("click", () => location.reload());
    choices.append(make("p", "muted", "The worlds could not be loaded."), retry);
  }
  dialog.showModal();
}

function renderWorld() {
  const world = state.world;
  const label = `World ${world.number} · ${world.name}`;
  document.title = `Ferrum | ${label}`;
  document.body.dataset.world = world.id;
  $("world-caption").textContent = label;
  $("hero-world-caption").textContent = label;
  $("map-caption").textContent = `${label} · ${list(state.campaign.quests).length} levels`;
  $("download-book").href = world.bookUrl;
  $("download-book").download = `Ferrum-${world.name}.pdf`;
  $("download-kit").hidden = !world.kitUrl;
  if (world.kitUrl) {
    $("download-kit").href = world.kitUrl;
    $("download-kit").download = world.id === "rust" ? "Ferrum-Field-Kit.zip" : `Ferrum-${world.name}-Field-Kit.zip`;
  }
}

async function boot() {
  bindControls();
  renderReaderControls();
  try {
    state.worlds = list((await api("/api/worlds")).worlds);
  } catch {
    openWorldPicker();
    return;
  }
  // Older page bookmarks without a world point to the original Rust book.
  const selection = new URLSearchParams(location.search).get("world") || (hashPage() ? "rust" : "");
  state.world = state.worlds.find((world) => world.id === selection) || null;
  if (!state.world) {
    readerMessage("Choose a world to open its book.", false);
    openWorldPicker();
    return;
  }
  const [campaign, status] = await Promise.allSettled([
    api("/api/campaign"), api("/api/status"),
  ]);
  if (campaign.status === "fulfilled") state.campaign = campaign.value;
  else state.campaignError = campaign.reason.message;
  state.total = pageNumber(state.campaign.total);
  if (status.status === "fulfilled") {
    state.runner = text(status.value.runner);
    state.storage = text(status.value.storage);
  }
  renderWorld();
  populatePaths();
  renderRunnerStatus();
  const heroId = tabHeroId();
  if (heroId) {
    try {
      const selected = await api("/api/heroes/load", { method: "POST", body: { id: heroId } });
      await activateHero(selected.hero, hashPage());
      return;
    } catch {
      rememberTabHero(null);
    }
  }
  readerMessage("Choose a hero to open the campaign book.", false);
  $("guide-content").replaceChildren(make("p", "muted", "Your guide will follow your hero through the book."));
  $("guide-content").setAttribute("aria-busy", "false");
  openHeroPicker();
}

boot();
