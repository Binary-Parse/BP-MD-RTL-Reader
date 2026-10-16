# Right-to-left text

This page explains how BP MD RTL Reader decides which way text runs, and why it works that way. For the steps to change direction, see [Work with Arabic and right-to-left text](USER_GUIDE.md#work-with-arabic-and-right-to-left-text).

## Contents

- [The problem](#the-problem)
- [How direction is decided](#how-direction-is-decided)
- [The rule for one block](#the-rule-for-one-block)
- [Overrides and what wins](#overrides-and-what-wins)
- [Numbers, links and code inside Arabic text](#numbers-links-and-code-inside-arabic-text)
- [Direction in Edit mode](#direction-in-edit-mode)
- [What is saved and what is not](#what-is-saved-and-what-is-not)
- [Direction in exports](#direction-in-exports)
- [Interface direction is separate](#interface-direction-is-separate)

## The problem

Many Markdown editors treat right-to-left (RTL) languages as a switch. You turn on an "RTL mode" and the whole note flips. That fails for the notes people actually write: an Arabic paragraph, then an English heading, then a code sample.

BP MD RTL Reader decides direction for each block. A paragraph, a heading and a list item each get their own direction. A note that mixes Arabic and English reads correctly without any switch.

## How direction is decided

Direction is decided at three levels. Each level has its own rule.

| Level | Decided by |
| ----- | ---------- |
| **The note** | Your manual choice, then the front matter `direction` key, then what the text contains |
| **A block** (paragraph, heading, list item) | A pin on that block, then the note's forced direction, then what the block contains |
| **A run inside a block** (a number, a link, inline code) | Its own first strong letter, isolated from the text around it |

"Auto" means the app uses what the text contains. "Forced" means you or the front matter chose RTL or LTR for the whole note.

## The rule for one block

The app looks at the letters in the block:

1. **If the first letter is Arabic, Hebrew or another right-to-left script, the block is right-to-left.** This is true even when Latin words follow. "تثبيت Docker على Windows" is Arabic text with a product name in it, so it runs right-to-left.
2. **If the first letter is Latin, the block is left-to-right, unless most of its letters are right-to-left.** An exact tie stays as it was. This catches a title such as "API دليل المستخدم", which starts with an English word but is mostly Arabic.
3. **If the block has no letters at all** (only digits, punctuation or an image), it inherits the direction around it.

Before counting, the app removes web addresses, email addresses and bare domains. Their Latin letters are identifiers, not English prose, and they used to push Arabic sentences to left-to-right.

The note as a whole uses the same rule on its prose. Code blocks, inline code and math are not counted. An Arabic article with a long code listing is still an Arabic note.

### Why first letter first

The first-letter rule is the standard way browsers and the Unicode bidirectional algorithm pick a base direction. It is predictable. You can see why a line runs the way it does.

Its one known failure is the opposite case: a mostly-Arabic line that starts with a Latin word. The majority check in rule 2 fixes that, without breaking rule 1. A Latin-first block needs a strict majority of right-to-left letters, so adding one English word to an Arabic paragraph never flips it by accident.

## Overrides and what wins

From strongest to weakest:

1. **A block pin.** `<!-- dir: rtl -->` or `<!-- dir: ltr -->` above one block.
2. **Your manual choice for the note.** The **Auto · RTL · LTR** switch or `Ctrl+Shift+L`.
3. **The front matter.** `direction: rtl` or `direction: ltr`.
4. **Auto.** What the text contains.

A forced direction (manual choice or front matter) applies to every block of the note. A pin still wins over it. Code blocks always stay left-to-right and cannot be pinned.

The manual switch beats the front matter. If you set LTR by hand on a note whose front matter says RTL, the note is left-to-right until you set it back to Auto.

## Numbers, links and code inside Arabic text

A number or a date has no direction of its own. Left alone inside an Arabic sentence, it can reorder. The date `2026-06-01` could show as `01-06-2026`, and `12:30` as `30:12`.

To prevent this, the app isolates these runs and fixes them left-to-right:

- numbers, dates and times
- `#tags`
- inline code
- links

Code blocks, math and Mermaid diagrams stay left-to-right too. A left-to-right run keeps its true order inside Arabic prose. The text around it keeps flowing right-to-left.

Quotes, lists and tables mirror with the block that holds them. A right-to-left table is a mirror image of a left-to-right one, and `:--` alignment means the right side.

## Direction in Edit mode

The editor applies the same rules to each line, so the line you type and the line you read run the same way. Lines inside a code block stay left-to-right. Pins are respected.

The editor reads at most the first 8,192 characters of a line to decide its direction. For a normal line this changes nothing. Cursor movement is logical, so the arrow keys follow each line's direction.

## What is saved and what is not

| Choice | Saved where | Lasts |
| ------ | ----------- | ----- |
| Front matter `direction` | In the note | Always |
| A block pin | In the note, as a hidden HTML comment | Always |
| Manual note choice (`Ctrl+Shift+L`) | In memory, for that tab | Until you relaunch. Each note reopens in Auto |

The manual choice is not saved on purpose. It is a quick view setting, so it never changes your file and never carries over to another note. If you want a direction to last, use the front matter or a pin. Both are plain text in the file, so they also reach HTML, PDF and EPUB exports.

## Direction in exports

HTML, PDF and EPUB exports carry the same per-block direction you see in Reading mode. They set `lang` and `dir` on the document. EPUB uses right-to-left page progression for an Arabic note. Table alignment follows the direction of the table, as it does in the app.

## Interface direction is separate

The **Arabic Interface (العربية)** setting changes the language and layout of the menus and panels. It does not change your notes. A right-to-left note shows correctly in the English interface, and an English note shows correctly in the Arabic interface.
