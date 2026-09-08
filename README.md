# Writing Desk

Five stages along the top, walked left to right: **Draft**, **Edit**,
**Comment**, **Format**, **Save**. They are one document seen five ways, not
five applications sharing a folder — and each one takes something away or
gives something back on purpose.

Behind them is **the desk**, which is where the documents live.

No backend, no build step, no accounts. It is a folder of files you can open.

## Run it locally

```bash
python3 serve.py
```

Then open http://localhost:4175/.

`serve.py` is `python3 -m http.server` with one addition: it tells the browser
not to cache. Without that, an edited `.js` file keeps being served out of the
browser cache and you debug code that is no longer running.

---

## The desk

The name in the top left is the way back to it. Every document you have is
lying there, as a sheet of paper showing its title and its opening lines,
grouped into piles by where it has got to.

The five piles are not the five stages, and that is deliberate. A stage is
what you are doing this minute; a status is what the piece is waiting for,
which is something you decide rather than something the application can work
out by watching you.

| Pile | For |
| --- | --- |
| Drafting | Getting it down |
| Editing | Working on it |
| Letting it mellow | Finished for now, deliberately left alone |
| Formatting | Making it an object |
| Done & sharing | Out in the world |

*Letting it mellow* is the one that earns the list. A draft that is resting is
doing something, and a shelf that cannot say so implies that everything not
being worked on has been abandoned.

Change a pile from the card on the desk, or from the control beside the title
while you are writing. Empty piles are not drawn — five labelled trays with
nothing in four of them is a filing system telling you off.

---

## Draft

A room with no back door. You can type and you can press return. You cannot
delete, you cannot undo, and there is no cursor to move — it sits wherever the
last character landed, which is the end. The only way out of a bad sentence is
the next one.

Formatting is markdown, typed rather than clicked, because there is nothing to
click:

| Keys | Gives |
| --- | --- |
| `⌘1` `⌘2` `⌘3` | heading one, two, three |
| `⌘B` | open bold; press again to close it |
| `⌘I` | open italic; press again to close it |
| `⌘⇧8` | a bullet |
| `⌘⇧7` | a numbered item |
| `⌘⇧9` | a quotation |
| `↵` | a new paragraph, or the next item of a list |
| `⇧↵` | a new line inside the same paragraph |

Return makes a paragraph, once, the way every other editor does. The draft
itself is plain text that has to stay valid markdown — where paragraphs are
separated by a blank line — so return writes two newlines rather than one, and
you see the gap it makes. Inside a list it writes one and carries the marker
on, since a blank line between bullets would take the list apart.

The markup stays on the page as characters. Seeing that a `**` is still open
is the only way to know you have to close it, and with no way back, closing it
is the only option.

**Take it to Edit** turns the draft into sections — one per level-one heading,
because that is what a writer means by typing one — and empties the room. It
is added, never substituted: nothing already in Edit is removed to make room
for it, including the introduction this application ships with, which is ours
to have written and yours to delete. Nothing here takes writing off the page
on its own.

Edit opens on the writing that just arrived rather than at the top of a
document that has grown by three sections, and the new part is marked for a
second so you can see which part is the new part. Writing that arrives with no
heading over it becomes a section called *New section*, which is a placeholder
rather than a guess dressed up as a title.

Nothing is carried over on its own — but nothing is quietly left behind
either. A dot sits on the Draft tab while there is writing still in the room,
since a draft is invisible from every other stage and the count in the top bar
does not include it. Walking away from an unmoved draft asks first, once, and
takes no for an answer.

**Fade what is behind you** dims the writing above the line you are on. The
fade is measured from that line rather than from the top of the window, so the
opening lines of a draft with nothing behind them yet are not dimmed for
having arrived early. The far end of the gradient stops short of nothing:
writing from ten minutes ago should be quiet, not gone.

**Hide panel** takes the rail away and gives the column the whole width, for
when the word count is the thing you would rather not be looking at.

### How the refusal works

The typing surface is a real, invisible textarea. Capturing raw key presses
would have been simpler, but a textarea is what the operating system knows how
to talk to: dead keys, dictation, an IME and a phone keyboard all work because
a genuine text field is focused. What is taken away is taken away in
`beforeinput`, the one hook a browser gives you to refuse an edit *before* it
happens — whatever caused it, including the delete key on a phone, the Edit
menu, and a trackpad gesture.

The column shakes its head the first couple of times you reach for delete and
then stops, while the message goes on appearing every time. Reaching for that
key is a twenty-year habit and it does not unlearn itself in an afternoon, so
the refusal has to survive being hit over and over without turning into a
scolding. A line of text you can ignore does that; a page that flinches does
not. Counted per habit, because knowing there is no delete tells you nothing
about the arrow keys.

### The one thing that gets shorter

Pressing return on an empty bullet ends the list, which means removing the
`- ` that is sitting there. That is allowed, and the distinction matters: the
marker was put there by the application a moment earlier, not typed by anyone.
No word you wrote is ever taken off the page.

---

## Edit

An ordinary editor, where everything Draft denied you comes back. Cut, move,
retitle, add a picture, break the piece into sections.

Sections are the draggable unit, not pages. Text that reflows and pages you
can drag are contradictory — add a sentence and every later page break moves,
so a page is not a thing that can hold a position. Sections reorder; pages
fall where the text puts them. Ticking **Start on a new page** begins a
section at the top of a fresh sheet, and `⌘↵` drops a break anywhere else.

A page break shows here as a small gap with a rule through it rather than as
the whole unused rest of the page. Drawing the real space was truthful and it
read badly — half a page of nothing in the middle of the column you are
writing in cuts the thread, and you end up scrolling past your own blank
paper. Format is where pages are the job, so that is where the real space is
shown. Pagination is the same either way: a break ends its page because it is
a break, not because of how tall it is.

Edit starts with the comments away. **Show Comments** in the toolbar brings
them back — the rail, the highlights, and the button that makes a new one —
and **Hide Comments** puts them away again. Edit is where you are writing
rather than annotating, so the notes wait until you ask for them.

You can type markdown at it and get the thing itself. The markup never
survives: it is swapped for real formatting the moment you finish it, and
nothing is stored as markdown.

| Type | Get |
| --- | --- |
| `# ` `## ` `### ` | headings one to three |
| `- ` `* ` `+ ` | a bulleted list |
| `1. ` | a numbered list |
| `> ` | a quotation |
| `---` then return | a rule |
| `**bold**` | bold |
| `*italic*` or `_italic_` | italic |

Emphasis only fires when both delimiters sit against a non-space, which is
what keeps `2 * 3 * 4` and `foo_bar_` as themselves. These are input rules
rather than a parser: text arriving all at once — a paste, or a line from
dictation — carries no trigger, which is right. Reading markdown wholesale is
the importer's job.

---

## Comment

The document, read-only, with somewhere to put remarks about it. Select any
passage and leave a note; the notes stack up in the rail on the right, and
each one is anchored to the words it was written about.

It is the same stage whether the reader is you or somebody else. Reviewing
your own draft is not a different act from reviewing a friend's, and the only
thing that changes is who is holding it — so self-review and shared review are
one screen rather than two.

What it does not have is what makes it a separate stage from Edit: no sections
rail, no block styles, no bold. You are reading, and the only thing you can
change is what you have to say.

The galley you are looking at is the real one, moved across from Edit rather
than copied. There is exactly one laid-out copy of the document in this
application; a second rendering would be a second set of line breaks, and a
note anchored against the wrong one.

**Sending it out**: they read it in their browser, highlight passages, leave
notes, and send the notes back. Nothing goes to a server, and there is no
account at either end.

### How a link with no server in it works

The whole draft is compressed, base64'd and hung off the URL fragment — the
part of a URL a browser keeps to itself and never puts on the wire. Whoever
you send it to gets the words out of their own address bar. Notes come back
the same way; a page of comments is a few kilobytes even before compression,
so the return trip always fits in a link however long the piece was.

Two honest limits decide when to send the file instead:

- **Pictures do not fit.** One photograph is larger than everything else put
  together. The link carries the words; **Download a reading file** carries
  the whole thing, images included.
- **A long piece makes a long link.** Browsers cope with far more than this,
  but chat and mail clients wrap and truncate. Past about 14,000 characters
  you get told so; past about 90,000 the link is not offered at all.

Opening a shared link puts the application into reading mode: the text is not
editable, the stages that would change it are gone, and — this is the part
worth being sure of — **nothing is written to the reader's storage**. Their own
document is still sitting there untouched when they close the tab. There is
exactly one route to `localStorage`, and in reading mode it does nothing.

### How a note stays attached

A comment points at a passage, and the passage is stored twice: as character
offsets into its section, which are exact but go stale the moment anyone types
above them, and as the words themselves, which never go stale but might appear
more than once. Neither is enough alone. The offsets are the fast answer and
the quote is how the note finds its way home afterwards — first at the
remembered position, then at the nearest occurrence of the quoted words, then
at the nearest occurrence with whitespace flattened, which catches a passage
that has been reflowed but not rewritten.

When none of those find it, the comment is not thrown away. It is marked and
shown on its own, because "somebody had something to say about a sentence you
have since deleted" is information.

Highlights are drawn as rectangles in a layer *under* the text rather than as
tags wrapped around it. Wrapping would put markup inside the editable content,
where it would be saved, exported and eventually mangled by someone selecting
across it — and a comment is a thing said *about* a document, not part of it.
Under rather than over so a click in a commented sentence still puts the caret
where you aimed; finding the note is done by where the click landed instead.

---

## Format

Where it becomes an object. Paper, margins, and one set of type rules that
every heading and paragraph of the same kind obeys at once — change Heading 2
and every Heading 2 in the piece moves with it.

Six papers, and one of them folds:

| Paper | Sheet | Page |
| --- | --- | --- |
| US Letter | 8.5 × 11 in | the same |
| A4 | 8.27 × 11.69 in | the same |
| A5 | 5.83 × 8.27 in | the same |
| Digest | 5.5 × 8.5 in | the same |
| Zine · Letter folded | 11 × 8.5 in | 5.5 × 8.5 in |
| Zine · A4 folded | 11.69 × 8.27 in | 5.845 × 8.27 in |

Two of the margins change their names with the paper. On a folded booklet they
are the fold and the trimmed edge, and the fold swaps sides from page to page
— give it a little more than the outside or the text creeps into the crease.
On anything else nothing swaps and they are simply left and right. Calling the
fold margin "left" on a page that has no fold is how people put their text
into the crease.

Five type families, all open licence, subset to Latin and embedded subset
again into the PDF:

| Family | For |
| --- | --- |
| EB Garamond | old-style serif, small and quiet — the default body |
| Libre Baskerville | sturdier serif, large on the body, reads well small |
| Inter | neutral sans, for captions and page numbers |
| Space Grotesk | geometric display sans, for headings |
| Courier Prime | typewriter monospace |

Licences are in `fonts/`.

---

## Save

**PDF**, and it is not a second attempt at laying the document out. There is
exactly one laid-out copy of the text — the editor's own column — and
everything else is that column plus a list of page offsets. The exporter walks
the live DOM, asks the browser where every word actually ended up, and writes
those positions down. Page previews are the same column seen through a smaller
hole. Nothing lays the text out twice, so nothing can disagree.

Two consequences worth knowing about:

**Kerning is off, deliberately.** A PDF advances glyphs by the widths in the
embedded font's width table, and a pair kern has nowhere to live in that
table. Left on in the browser, every line would set a fraction narrower on
screen than on paper — half a pixel a word, a couple of pixels a line — and the
preview would stop being the truth. Ligatures stay on: a ligature is a single
glyph with a single advance, so both sides already agree about it.

**Fonts are static, not variable.** Every face in `fonts/` was instanced from
its variable original to a fixed weight. The browser will happily interpolate
a weight along an axis, but the PDF embeds a *file*, and an embedded variable
font arrives at its default instance — bold would come out regular with nothing
to indicate it.

**Print and fold order** is the other way out: the sheets in the order the
printer needs them, two pages to a sheet, blanks added at the end to round the
count up to a multiple of four.

It is offered whatever paper you are on, but it is not a thing that can be
applied to a finished US Letter document on the way out. Fold a sheet in half
and you have two pages, each half the width — so a booklet has to have been
*laid out* in half pages or the preview is showing something the PDF will not
contain. Choosing it on paper that does not fold offers to change the paper
first, keeping your margins and type and reflowing the text. You can switch
back in Format. Print at 100% — no "fit to page", which
would shrink the sheet and put the margins somewhere else — double-sided, fold
the whole stack together, staple twice on the fold. If the second side comes
out upside down relative to the first, that is your printer's duplex flip and
not the file: turn on **Rotate back sides 180°** and export again.

Other formats:

- **Markdown** — prose and structure, in a file any editor can open.
- **Plain text** — the words with the markup taken back out.
- **Web page** — one self-contained HTML file with the type settings inlined
  and pictures embedded. Fonts are *named*, not embedded; a megabyte of TTF in
  a file meant to be small and readable anywhere is the wrong trade.
- **Everything (.json)** — the complete one. Words, pictures, comments and
  every setting. This is the only export that brings all of it back.

---

## Small screens

Below about nine hundred pixels the application replaces itself with a line
saying so. That is not a judgement about phones — a US Letter page is 816
pixels wide before either rail is drawn, so there is no arrangement of this
interface that works on one. The test covers both dimensions, because a phone
held sideways is wide and short.

It is done in the stylesheet rather than in script, so it is right before
anything has loaded, and stays right if nothing ever does.

## Where your work lives

In this browser. Documents go to IndexedDB, one record each, shortly after you
stop typing; so do pictures. Only the id of the document you had open is in
`localStorage`, because it is the one thing that has to be known before
anything else can be read.

It used to be a single `localStorage` key, which is the right shape for one
document and the wrong one for a shelf of them: the whole origin gets about
five megabytes, every save re-serialises the lot, and there is nowhere to put
a second. A document already in that key is moved across the first time this
version runs, and the old key is renamed rather than deleted — a migration
that goes wrong should be recoverable by hand rather than being somebody's
writing.

Pictures are filed under the document that uses them. That is what stops
tidying up one document from deleting another one's photographs.

That means clearing site data takes the lot. **Save a copy**, under Document in
the Format rail and again under Save, writes the whole thing — pictures and
comments included — to a single `.json` file you can keep somewhere else or
open on another machine.

The stage you were last on is kept too, so reopening a document puts you back
where you left it rather than at whichever stage happens to be second.

Storage is per-origin, so work done on `localhost` does not follow you to a
deployed copy.

Whether Edit is showing the comments is kept with the document too, since it
is a fact about how you are working on that piece rather than a preference
that should follow you into the next one.

Every question the application asks — deleting a section, throwing a document
away, opening a file over the top of one — is asked in the page rather than
through `confirm`. Embedded browser views, pages the browser has been told to
stop showing dialogs for, and several mobile browsers all answer `confirm`
with a silent no, which turns a destructive button into a button that appears
to be broken.

---

## Files

| File | Holds |
| --- | --- |
| `js/doc.js` | the document, its settings, storage, and the picture store |
| `js/draft.js` | the room with no back door |
| `js/comments.js` | anchoring a note to a passage, and keeping it there |
| `js/share.js` | packing a draft into a link, and notes back out of one |
| `js/flow.js` | the one stylesheet that decides where a line falls |
| `js/paginate.js` | measuring real line boxes and choosing the breaks |
| `js/imposition.js` | which pages share a sheet, and which margin is the fold |
| `js/editor.js` | the writing surface: sections, commands, paste, pictures |
| `js/markdown-input.js` | swapping markdown for formatting as you type it |
| `js/markdown.js` | reading and writing markdown files |
| `js/preview.js` | page and sheet previews, and the seams over the editor |
| `js/extract.js` | reading positions and metrics back out of laid-out DOM |
| `js/pdf.js` | writing the pages, via a vendored pdf-lib |
| `js/zip.js` | a stored-method zip, for when you want both orders at once |
| `js/settings-ui.js` | the settings rail, built from a description |
| `js/app.js` | wiring |
| `serve.py` | dev server that refuses to let the browser cache |

## Where it came from

Two earlier things, and it is meant to be obvious which parts:

[**Typewriter**](https://github.com/swoloszynski/typewriter) is a browser
typewriter that behaves like a machine instead of a text box — no cursor, no
undo, every key stamping ink where the carriage happens to be. Draft is that
idea with the mechanism taken out and the discipline kept.

[**Zine Press**](https://github.com/swoloszynski/zine-press) writes in half
pages and prints in folded sheets. Edit, Format and Save are its engine,
generalised so paper does not have to fold: a `PAPER` entry now carries a page
and a sheet, which are the same rectangle for everything except a booklet, and
the margins stop alternating when there is no fold to lean away from.
