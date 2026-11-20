---
name: book-reviewer
description: Review Coding Dungeons books, chapters, or reading notes for technical reliability, clear explanations, teaching progression, and game alignment.
---

# Book Reviewer

Use this for critique. A review request alone does not require rewriting or rebuilding the book.

## Ground the review

- Identify the book's thesis, intended developer experience, language baseline, and genre. Rust's advanced conceptual route and C#'s beginner course have different expectations.
- Read the requested scope from its manuscript/source and check the published edition when pagination, diagrams, or question placement matters. State what was actually read.
- Map the argument or learning arc: prerequisites, worked examples, practice, boss constraints, and the final artifact. Evaluate the campaign as well as its prose.
- Distinguish grammatical defects, pedagogical improvements, factual errors, and deliberate scope limits. Thematic routes may offer advisory prerequisites rather than a complete curriculum.

See the [repository map](../../references/repository-map.md) for source locations and the [validation matrix](../../references/validation-matrix.md) for evidence available to a reviewer.

## Judge claims within their scope

- Check uncertain or changed technical claims against primary language/library documentation. Record the edition, compiler, target, and date where those affect the conclusion.
- A successful compiler check supports type acceptance. It does not establish runtime correctness, unsafe soundness, progress, durability, or a remote effect.
- Inspect whether an example exercises the mechanism it teaches. An executor that only sees `Ready`, for example, does not demonstrate waking after `Pending`.
- Keep executable listings, deliberately rejected examples, and sketches distinct. Do not report an intentional compile failure as a book defect.
- Compare prose contracts with reference solutions and discriminating tests. Identify what a graded drill covers and what remains a design review.
- Separate a supported baseline from the latest release and from the experimental mobile backend. An older explicit baseline is not automatically inaccurate.

## Make revisions actionable

For each material finding, give the exact location, evidence, reader impact, and a concrete correction. Prefer an annotated borrow graph, a failing schedule, or a worked integration over a vague request for more detail. Do not force a quota of problems or invent unverified facts.

Preserve careful qualifications when simplifying sentences. A shorter sentence that implies cancellation rolls back work, or that tests prove soundness, is a regression.

## Output format

Use the user's requested format when given; otherwise retain this rubric:

- **Overview & Thesis** — audience, central argument, and learning arc.
- **Key Strengths** — specific explanations or examples that work well.
- **Critique & Gaps** — grounded findings, separating correctness from teaching or editorial issues.
- **Actionable Takeaways** — ordered revisions or reading strategies.

Report unresolved validation honestly. Do not call the book fully current or publication-ready solely because prior release tests passed.
