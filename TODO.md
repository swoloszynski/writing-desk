# Not built yet

Things decided but not made. One heading each; delete a section when it ships.

---

## Collaborative review, in stages

**Status:** designed, not started. The solo workflow stays as it is — comments
only, no track changes.

### The idea it rests on

A review contains two different acts, and every tool I have used collapses
them into one:

- A **correction** is unambiguous. A typo, a doubled word, its for it's.
  There is nothing to articulate, and making somebody write a sentence about
  a missing comma is friction with no payoff — the real result is that they
  stop bothering to fix small things.
- A **revision** is a judgment about voice, structure or emphasis. Here the
  friction is the point. Being made to say *why* forces a reader to diagnose
  rather than reflexively reword, and it leaves the fix with the person whose
  voice it is.

So: track changes belongs to corrections and nowhere else. Everything that is
a judgment has to be said in words before it can be sent. This is the one rule
that makes this different from Docs rather than a copy of it, and it is the
reason the two are separated in the flow below instead of being one gesture
with a checkbox.

It is also the reason Comment mode currently refuses to edit the document at
all, and why highlights are drawn in a layer instead of wrapped around the
text: a comment is a thing said *about* a document. Corrections will be the
single, deliberate exception to that, and should look like one.

### The flow

Adapted from the Critical Response Process — the numbered steps below map to
its four. (Worth reading the original before building this; I believe it is
Liz Lerman's, and the ordering is doing more work than it looks like.)

**Writer, before sending it out**

- Questions for the reviewer to consider. *(step 2)*

**Reviewer**

1. Comments on what is working. *(step 1)*
2. Revision notes:
   - Answers to the writer's questions. *(step 2)*
   - The reviewer's own questions. *(step 3)*
   - Suggestions and opinions, **topic named first, opinion second** — "I have
     something to say about the ending" before the thing about the ending.
     *(step 4)*
3. Corrections — track changes, copy edits. A separate track, not mixed in
   with the above.

**Writer, reading it back**

- Default to one step at a time, in order. The order is the method; showing
  everything at once turns it back into an undifferentiated pile of notes.
- Option to reveal suggestions and opinions one by one, topic first, so the
  writer can decide whether they want to hear it.
- Option to show everything at once, labelled by step, for anyone who would
  rather have the pile.

### Notes for whoever builds it

- The step is a property of the note. Adding a `step` to a comment is most of
  the data model; the rest is filtering and the reveal.
- Corrections need a different mechanism from comments, because they are the
  one thing that does touch the text. Two routes were costed:
  - **Full inline track changes.** The document plus pending changes rendered
    as one view with `ins`/`del`, edited directly. Needs a position-mapping
    layer translating edits in that view back to clean-document offsets, and
    a decision about pagination, which measures real line boxes and would be
    measuring text that is not in the document. Days, and it touches the most
    delicate machinery in the app.
  - **Per-paragraph capture.** Click into a paragraph, edit it freely, and on
    blur diff it, revert the DOM and store the result as an anchored
    replacement — which is the shape `comments.js` already has. Shown as a
    word-level diff so it reads like track changes. Roughly a day, no new
    architecture. A change spanning two paragraphs becomes two of them, and
    formatting inside an edited paragraph is lost.

  Start with per-paragraph capture. It gets most of the feel for a tenth of
  the risk, and the data it produces is the same shape either way.
- Whatever is built has to survive the link round trip, which means it is
  carried in the notes payload and merged by id like everything else.
- Only the writer accepts. A reader is holding a copy; letting them accept
  would change their copy and nothing else, which looks exactly like having
  changed the document.
