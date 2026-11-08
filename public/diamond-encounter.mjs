import { mountCreature } from "./creatures.mjs";

function element(tag, className = "", copy = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = copy;
  return node;
}

function svgElement(tag, attributes) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

// Keep the gem near its rolled position while giving existing book links room.
export function diamondPosition({ x, y }, links) {
  const offsets = [[0, 0], [14, 0], [-14, 0], [0, 10], [0, -10], [14, 10], [-14, -10]];
  const bound = (value) => Math.max(8, Math.min(92, value));
  const rectangles = links.map(({ x, y, w, h }) => [x, y, w, h].map(Number))
    .filter(([x, y, w, h]) => [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0);
  const isClear = (left, top) => rectangles.every(([x, y, w, h]) =>
    left + 8 < x || left - 8 > x + w || top + 6 < y || top - 6 > y + h);
  for (const [dx, dy] of offsets) {
    const left = bound(x + dx);
    const top = bound(y + dy);
    if (isClear(left, top)) return { x: left, y: top };
  }

  let nearest;
  let distance = Infinity;
  for (let left = 8; left <= 92; left += 4) {
    for (let top = 8; top <= 92; top += 4) {
      const candidateDistance = (left - x) ** 2 + (top - y) ** 2;
      if (candidateDistance < distance && isClear(left, top)) {
        distance = candidateDistance;
        nearest = { x: left, y: top };
      }
    }
  }
  return nearest ?? { x: bound(x), y: bound(y) };
}

export function createDiamondButton(position) {
  const button = element("button", "page-diamond");
  button.type = "button";
  button.setAttribute("aria-label", "Inspect hidden diamond");
  button.title = "Inspect hidden diamond";
  button.style.setProperty("--diamond-x", `${position.x}%`);
  button.style.setProperty("--diamond-y", `${position.y}%`);
  const icon = svgElement("svg", { viewBox: "0 0 40 40", "aria-hidden": "true" });
  icon.append(
    svgElement("path", { d: "M10 12h17l6 7-14.5 15L4 19z", fill: "#60e8ff", stroke: "#14334e", "stroke-width": "1.6", "stroke-linejoin": "round" }),
    svgElement("path", { d: "M4 19h29L18.5 34 13 19l3-7m11 0-3 7-5.5 15", fill: "none", stroke: "#2889ab", "stroke-width": "1.2" }),
    svgElement("path", { d: "m10 12-6 7h9l3-7zm6 0-3 7h11l-3-7z", fill: "#e5fcff" }),
    svgElement("path", { d: "m33 3 1.2 4.8L39 9l-4.8 1.2L33 15l-1.2-4.8L27 9l4.8-1.2z", fill: "#fff8cd" }),
  );
  button.append(icon);
  return button;
}

export function createDiamondEncounter(initial, {
  canSubmit, runnerUnavailable, submit, readDraft, saveDraft, clearDraft, renderReport,
}) {
  const { encounter } = initial;
  const card = element("section", "field-card special-encounter diamond-encounter");
  const encounterDetails = element("details");
  const summary = element("summary", "diamond-heading");
  const identity = element("div");
  const title = element("h2", "", encounter.title);
  title.id = "diamond-encounter-title";
  card.setAttribute("aria-labelledby", title.id);
  identity.append(element("p", "eyebrow", "HIDDEN AMBUSH"), title);
  const status = element("p", "special-status");
  status.setAttribute("role", "status");
  summary.append(identity, status);
  const description = element("p", "special-description", encounter.description);
  const canvas = element("canvas", "special-arena diamond-arena");
  canvas.setAttribute("aria-hidden", "true");
  const steps = element("ol", "special-steps diamond-steps");
  steps.setAttribute("aria-label", "Goblin fight stages");
  const body = element("div", "special-body diamond-body");
  const feedback = element("div", "prompt-feedback");
  feedback.hidden = true;
  feedback.setAttribute("aria-live", "polite");
  encounterDetails.append(summary, description, canvas, steps, feedback, body);
  encounterDetails.open = initial.completed.length < encounter.stages.length;
  card.append(encounterDetails);

  let disposed = false;
  let busy = false;
  let attack;
  let examples;
  const sprite = mountCreature(canvas, { goblin: true, defeated: !encounterDetails.open });

  function updateAvailability() {
    const disabled = busy || !canSubmit() || Boolean(examples && runnerUnavailable);
    if (attack) attack.disabled = disabled;
    if (examples) examples.disabled = disabled;
  }

  function render(view, animate = false) {
    const completed = view.completed;
    const current = encounter.stages.find((stage) => !completed.includes(stage.id));
    const finished = !current;
    status.textContent = finished ? "Goblin defeated" : `${completed.length} / ${encounter.stages.length} strikes landed`;
    sprite.update(finished, { animate });
    steps.replaceChildren(...encounter.stages.map((stage) => {
      const cleared = completed.includes(stage.id);
      const item = element("li", "", cleared ? `✓ ${stage.title}` : stage.title);
      item.dataset.step = cleared ? "cleared" : stage === current ? "current" : "waiting";
      if (stage === current) item.setAttribute("aria-current", "step");
      return item;
    }));

    if (finished) {
      const loot = element("p", "special-victory", `You recovered the goblin’s bag. +${encounter.rewardDiamonds} diamonds`);
      loot.tabIndex = -1;
      body.replaceChildren(loot);
      attack = null;
      examples = null;
      if (animate) loot.focus();
      return;
    }

    const code = current.kind === "code";
    const form = element("form", "special-form");
    const heading = element("h3", "", current.title);
    heading.tabIndex = -1;
    form.append(heading);
    const controls = element("fieldset", "special-controls");
    controls.append(element("legend", "", current.prompt));
    let input;
    if (code) {
      if (current.signature) controls.append(element("pre", "signature", current.signature));
      input = element("textarea", "code-editor");
      input.setAttribute("aria-label", "Goblin code");
      input.value = readDraft() ?? (view.draft || current.starter || "");
      input.rows = 9;
      input.maxLength = 49152;
      input.required = true;
      input.spellcheck = false;
      input.autocapitalize = "off";
      input.autocomplete = "off";
      input.addEventListener("input", () => saveDraft(input.value));
      controls.append(input);
    } else {
      for (const option of current.options) {
        const label = element("label", "special-option");
        const radio = element("input");
        radio.type = "radio";
        radio.name = "goblin-choice";
        radio.value = option.id;
        radio.required = true;
        label.append(radio, element("span", "", option.label ?? option.text));
        controls.append(label);
      }
    }

    const actions = element("div", "form-actions");
    attack = element("button", "button button-primary", code ? "Submit code" : "Submit answer");
    attack.type = "submit";
    attack.dataset.expeditionSubmit = "";
    actions.append(attack);
    examples = code ? element("button", "button button-quiet", "Run Examples") : null;
    if (examples) {
      examples.type = "submit";
      actions.append(examples);
    }
    const message = element("p", "inline-status");
    message.setAttribute("role", "status");
    if (code && runnerUnavailable) controls.append(element("p", "fine-print", runnerUnavailable));
    controls.append(actions);
    form.append(controls, message);
    body.replaceChildren(form);
    updateAvailability();
    if (animate) heading.focus();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const practice = code && event.submitter === examples;
      if (busy || disposed || !canSubmit() || (code && runnerUnavailable)) return;
      const value = code ? input.value : new FormData(form).get("goblin-choice");
      if (!value?.trim()) {
        message.textContent = code ? "Enter some code first." : "Choose an answer first.";
        return;
      }
      busy = true;
      controls.disabled = true;
      updateAvailability();
      message.textContent = code ? "Compiling and testing…" : "The GM is checking your answer…";
      feedback.hidden = true;
      const answer = code ? { code: value, purpose: practice ? "examples" : "submit" } : { optionId: value };
      try {
        const next = await submit({ stageId: current.id, ...answer });
        if (disposed) return;
        message.textContent = "";
        if (code) {
          renderReport(feedback, next.result);
          if (next.result.feedback) feedback.append(element("p", "fine-print", next.result.feedback));
        } else {
          feedback.dataset.verdict = next.result.correct ? "correct" : "incorrect";
          feedback.replaceChildren(element("p", "", next.result.feedback));
          feedback.hidden = false;
        }
        if (next.completed.includes(current.id)) {
          if (code) clearDraft(value);
          render(next, true);
        }
      } catch (error) {
        if (!disposed) {
          message.textContent = error.message;
          message.dataset.error = "true";
        }
      } finally {
        busy = false;
        controls.disabled = false;
        if (!disposed) updateAvailability();
      }
    });
  }

  render(initial);
  return {
    card,
    focus() {
      encounterDetails.open = true;
      summary.focus();
    },
    updateAvailability,
    destroy() {
      disposed = true;
      sprite.destroy();
      card.remove();
    },
  };
}
