import { mountCreature } from "./creatures.mjs";

function element(tag, className = "", copy = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = copy;
  return node;
}

function button(copy, type = "button") {
  const node = element("button", "button button-primary", copy);
  node.type = type;
  return node;
}

export function encounterKind(encounter) {
  return encounter.kind === "elite" ? "Elite boss" : "Bug Hunt";
}

export function createSpecialEncounter(encounter, { load, submit, canSubmit = () => true }) {
  const elite = encounter.kind === "elite";
  const stages = encounter.stages;
  const card = element("section", "field-card special-encounter");
  card.dataset.kind = encounter.kind;
  const heading = element("div", "special-heading");
  const identity = element("div");
  const title = element("h2", "", encounter.title);
  title.id = `special-title-${encounter.id}`;
  card.setAttribute("aria-labelledby", title.id);
  identity.append(element("p", "eyebrow", encounterKind(encounter)), title);
  const status = element("p", "special-status", "Loading encounter…");
  status.setAttribute("role", "status");
  heading.append(identity, status);
  card.append(heading, element("p", "special-description", encounter.description));

  const canvas = elite ? element("canvas", "special-arena") : null;
  if (canvas) {
    canvas.width = 320;
    canvas.height = 116;
    canvas.setAttribute("aria-hidden", "true");
    card.append(canvas);
  }
  const steps = element("ol", "special-steps");
  steps.setAttribute("aria-label", elite ? "Armor locks" : "Investigation steps");
  const body = element("div", "special-body");
  const feedback = element("div", "special-feedback");
  feedback.hidden = true;
  feedback.setAttribute("role", "status");
  card.append(steps, feedback, body);

  let renderer;
  let disposed = false;

  function showFeedback(result) {
    feedback.hidden = false;
    feedback.dataset.correct = String(result.correct);
    feedback.replaceChildren(element("p", "", result.feedback));
    if (result.trace?.length) {
      const trace = element("ol", "special-trace");
      for (const event of result.trace) trace.append(element("li", "", event));
      feedback.append(trace);
    }
    if (result.checks?.length) {
      const checks = element("ul", "special-checks");
      for (const check of result.checks) {
        const item = element("li");
        const badge = element("span", "badge", check.passed ? "Pass" : "Fail");
        badge.dataset.done = String(check.passed);
        item.append(badge, element("span", "", check.label));
        checks.append(item);
      }
      feedback.append(checks);
    }
  }

  function render(completed, { focus = false, animate = false } = {}) {
    const firstOpen = stages.find((stage) => !completed.includes(stage.id));
    const finished = !firstOpen;
    card.dataset.completed = String(completed.length);
    status.textContent = finished ? (elite ? "Elite defeated" : "Case closed")
      : `${completed.length} / ${stages.length} ${elite ? "locks broken" : "steps complete"}`;
    if (canvas) {
      if (!renderer) renderer = mountCreature(canvas, { world: encounter.world, level: encounter.level, defeated: finished, elite: true });
      else renderer.update(finished, { animate });
    }

    steps.replaceChildren(...stages.map((stage, index) => {
      const cleared = completed.includes(stage.id);
      const item = element("li", "", `${cleared ? "✓" : index + 1} · ${stage.title}`);
      item.dataset.step = cleared ? "cleared" : stage === firstOpen ? "current" : "waiting";
      if (stage === firstOpen) item.setAttribute("aria-current", "step");
      if (cleared) item.append(element("span", "visually-hidden", " (complete)"));
      return item;
    }));

    if (finished) {
      const done = element("p", "special-victory", elite
        ? "All three locks are open. Your victory is saved to this hero."
        : "You reproduced the bug and verified the fix. This case is saved to your hero.");
      done.tabIndex = -1;
      body.replaceChildren(done);
      if (focus) done.focus({ preventScroll: true });
      return;
    }

    const stage = firstOpen;
    const form = element("form", "special-form");
    const stageHeading = element("h3", "", stage.title);
    stageHeading.tabIndex = -1;
    form.append(stageHeading);
    if (stage.code) form.append(element("pre", "signature special-code", stage.code));
    const controls = element("fieldset", "special-controls");
    const options = stage.options ?? [];
    const selectedCode = element("pre", "signature special-code");
    selectedCode.hidden = true;
    if (options.length) {
      controls.append(element("legend", "", stage.prompt));
      for (const option of options) {
        const label = element("label", "special-option");
        const radio = element("input");
        radio.type = "radio";
        radio.name = "optionId";
        radio.value = option.id;
        radio.required = true;
        radio.addEventListener("change", () => {
          selectedCode.textContent = option.code ?? "";
          selectedCode.hidden = !option.code;
        });
        label.append(radio, element("span", "", option.label));
        controls.append(label);
      }
      controls.append(selectedCode);
    } else {
      controls.append(element("p", "", stage.prompt));
    }
    const action = button(stage.actionLabel, "submit");
    action.dataset.expeditionSubmit = "";
    action.disabled = !canSubmit();
    controls.append(action);
    form.append(controls);
    body.replaceChildren(form);
    if (focus) stageHeading.focus({ preventScroll: true });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (disposed || controls.disabled || !canSubmit()) return;
      const optionId = new FormData(form).get("optionId");
      const input = { stageId: stage.id };
      if (optionId) input.optionId = optionId;
      controls.disabled = true;
      try {
        const next = await submit(input);
        if (disposed) return;
        showFeedback(next.result);
        if (next.completed.includes(stage.id)) render(next.completed, { focus: true, animate: true });
      } catch (error) {
        if (!disposed) showFeedback({ correct: false, feedback: error.message });
      } finally {
        controls.disabled = false;
      }
    });
  }

  async function start() {
    status.textContent = "Loading encounter…";
    body.replaceChildren();
    try {
      const saved = await load();
      if (!disposed) render(saved.completed);
    } catch (error) {
      if (disposed) return;
      status.textContent = "Encounter unavailable";
      const retry = button("Retry encounter");
      retry.addEventListener("click", start);
      body.replaceChildren(element("p", "muted", error.message), retry);
    }
  }

  return {
    card,
    start,
    destroy() {
      disposed = true;
      renderer?.destroy();
    },
  };
}
