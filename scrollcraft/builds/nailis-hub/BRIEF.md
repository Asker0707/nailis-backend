Self-authored, not interviewed

The user asked to build a new Nailis.hub homepage as a scroll page from the existing copy in `templates/index.html`, and to leave the cabinet, courses, and admin untouched. Creative questions were not asked. Decisions below are authored from the live page, its photographs, and its prices. Nothing here is a user quotation.

## 1. Vibe

Studio journal, close, exact, warm, unhurried.

References used as mood, not as sites to copy: a manicurist's day book, a printed certificate, a lamp over a pale table.

## 2. Scroll journey, in the page's own order

1. The offer, said plainly: individual manicure training.
2. The reason it matters: a coating you can raise the price for.
3. The person: Olesya Dyshekova, five years, her own clients.
4. What leaves with the student: hand, three months of feedback, a portfolio.
5. The formats: Junior, Middle, online later, and paying in parts.
6. A quiet beat.
7. The students' hands, scrubbed.
8. The booking: name, phone, or Telegram.

## 3. Energy

Quiet on the title. Sharper on the price line. Close and human on the portrait. Steady on the outcomes. Brisk across the formats. Almost still. Then the longest, slowest look at the work. Quiet again on the form.

## 4. Feeling curve

1. Recognition. The title page names the thing they came for, type on paper, no photograph yet.
2. Unease. A dark page, and the line about a coating you would be ashamed to charge more for.
3. Intimacy. Her cut-out portrait stands in front of a certificate, a print of a finished set overlaps the lower edge.
4. Confidence. Five years and three months of feedback count up beside the three things they leave with.
5. Appetite. The formats travel sideways, each one labelled the same way, prices real.
6. Calm. One short line and a lot of paper. Nothing else moves.
7. Awe. The student set fills a column and the wheel scrubs the clip. This is the peak.
8. Resolve. The day card's last line is their name, and the form is waiting.

## 5. The one thing

The margin is a training-day card. Passing a chapter stamps a line that stays. Typing a name writes the last line.

## 6. Range

Editorial. The brand already prints certificates and speaks in full sentences. Premium-minimal would sand off the person. The palette is the brand's own: paper `#EDE6D8`, espresso `#311B14`, lacquer `#8C3F36`. Those colours are named by the existing site, not chosen as a default artisan costume.

## 7. World or scenes

Distinct scenes. The current page is already chapters (offer, instructor, tariffs, work, questions). It is not one camera flight through a place.

## 8. Assets

Used, not generated:

- Portrait cutout `static/images/lesya-hero-Photoroom.png` (real alpha).
- Certificates: `sertificat.jpg`, `foto_1.jpg`, `foto_2.jpg`, `foto_3.jpg`, `lesya.jpg`.
- Student clip `static/videos/hero/IMG_0062_hero.mp4`, re-encoded to 30fps, no audio, dense GOP: `static/videos/scroll/works.mp4` (`-g 8`) and `works-m.mp4` (`-g 4`).
- Review stills: `static/otzyv/akmaral.jpg`, `alena.jpg`, `anna.jpg`, `marya.jpg`.

No kie.ai spend. The skill copy in this repo has no `scripts/` (`doctor.mjs`, `workspace.mjs`, `encode.sh` are absent). Node v22 and ffmpeg 6.1.1 were checked by hand. Workspace resolved by the documented rule to `<project>/scrollcraft` (no `SCROLLCRAFT_HOME`, no `.scrollcraft.json`).

## Feeling curve (locked before the score)

1. Recognition. Title on paper, lead corner, link already visible.
2. Unease. Dark ground, the price sentence wiping open.
3. Intimacy. Three planes in the portrait column: certificate, person, nail print.
4. Confidence. The numerals 5 and 3 counting beside the outcomes.
5. Appetite. Tariffs and the installment calculator travelling sideways.
6. Calm. A single line, held in space.
7. Awe. The scrub of a real student set. Largest span.
8. Resolve. Form, FAQ, colophon. The card shows the name.

## Peak

"The page goes quiet, then a real set is under your hand and you scrub the clip yourself."

Lives in the works act.

## Tell-someone

It's the site where the margin fills in like a training-day card, and the name you type becomes the last line.

## Authored silence

The chapter "Руки" is one line and empty paper on purpose. It is the quiet before the scrub. It is not dead scroll.

## Journey

1. Recognition. They see the offer they already wanted.
2. Tension. Cheap work and a check they cannot raise.
3. Turn. One instructor, in person.
4. Substance. Technique, three months, a portfolio.
5. Range. Junior, Middle, later online, paying in parts.
6. Proof. The students' hands.
7. Commitment. Leave a name, or write in Telegram.

## Grammar

Chaptered editorial.

Why the other seven lost:

- Filmic one-shot would hide the seams this page needs: a price list, a person, a clip, a form. It is also the skeleton the skill is trying not to repeat, and the interview did not ask to be carried.
- Live surface. This is not software. The calculator is one tool inside a chapter.
- Continuous world. There is no geography to fly through.
- Typographic poster. The proof is photographic. Dropping the portrait, the certificates, and the student clip would throw away the only evidence the school has.
- Gallery. The visitor's question is whether to trust this person with 45 000 ₽, not only which object to pick. Labels alone cannot carry the instructor.
- Split stage. Junior and Middle are a choice, not two columns held in tension for the whole page.
- Rhythmic cutlist. A three-day course and a day-by-day program need to be read. A cut every second fights the content.

## Score

| Beat | Device | Why |
|---|---|---|
| Recognition | flow | A title page. Type is present on load. Media starts in the next chapter. |
| Unease | reveal | A wipe is the change from "I want this" to "this is what it costs me to stay average". |
| Intimacy | parallax | Three photographic planes, person between certificate and a finished set. |
| Confidence | count | Only real figures: 5 years, 3 months. |
| Appetite | pan | Lateral travel reads as a choice of format. |
| Calm | kinetic | One line assembles. The page is otherwise still. |
| Awe | scrub | The only clip. Largest span. Dwell so the set settles. |
| Resolve | flow | A colophon you can fill in. No magnet, no spotlight. |

Families in order: flow, reveal, parallax, count, pan, kinetic, scrub, flow. Eight, no adjacent repeat. One scrub. No pin, so no pinned crossfade. No drift, so chapter grounds hard-cut. No spotlight, no magnet.

Spans that are pinned: pan `2.8`, scrub `4.0`. The scrub is the longest act. Flow chapters stay short. Total is not the 6-to-7 act, 13.6-13.8vh band.

## Signature move

A fixed training-day card in the margin. Scroll stamps a line per chapter and the line stays. The lines are links back to those chapters. The name field writes into the card's last line. Coded in `static/js/home-scroll.js`. The engine is not edited.

## Close

Colophon. The action label everywhere is «Записаться». Tariff links open Telegram with the course text from the old page. The form posts to `/api/callback`. FAQ sits in the same chapter, before the form, so the last screen is the form and the small print.

## What the visitor should believe

One person will set their hand, in person, and stay for three months after.

## Next action

Записаться.
