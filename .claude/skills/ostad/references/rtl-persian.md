# RTL and Persian text

## Layout

`<html lang="fa" dir="rtl">`. Everything inherits from there.

**Logical properties only.** `ms-` `me-` `ps-` `pe-` `start-` `end-`
`text-start` `text-end`. Never `ml-` `mr-` `pl-` `pr-` `left-` `right-`
`text-left` `text-right`.

This is not a style preference. Physical properties in an RTL app produce
layouts that look fine to whoever wrote them and broken to every actual user,
and the bugs are invisible until someone opens the page in Persian. Writing
logical properties from the first line costs nothing; converting a built app
costs days.

When you install an AI Elements component, convert its physical properties
immediately, before building on it. The source is in our repo — that is the
point of using a shadcn registry.

## Mixed direction

Persian prose is RTL; formulas, numbers, code, and URLs are LTR. Put `dir="auto"`
on every rendered text block, and wrap known-LTR spans explicitly:

```tsx
<span dir="ltr" className="inline-block">{formula}</span>
```

`inline-block` matters — without it the bidi algorithm still reorders around the
span and you get formulas that render backwards in the middle of a sentence.

## Fonts

Vazirmatn (variable). Load with `next/font/local` and `display: swap`.
Do not fetch Persian webfonts from a foreign CDN — it is an extra
international dependency on the critical render path for something we can self-host.

## Normalization

One function, `lib/knowledge/normalize.ts`, applied **identically at ingest and
at query time**. If the two diverge, recall drops and nothing errors.

It must handle:

- Arabic vs Persian letters: `ي` → `ی`, `ك` → `ک`
- Arabic, Persian, and Latin digits → one form
- ZWNJ (نیم‌فاصله) and the variants people type instead of it
- Diacritics (اعراب) — strip
- Tatweel (`ـ`) — strip
- Whitespace collapse

Store the result in `contentNorm` and search against that column. Keep the
original `content` for display — never show the user normalized text.

## Strings

Persian goes directly in the JSX. No `t()`, no locale files, no key namespace.

This is deliberate. The product has exactly one audience and one language, and a
translation layer would add a lookup at every call site plus a permanent class of
missing-key defects in exchange for flexibility nobody has asked for. If a second
locale is ever funded, extracting literals is a mechanical pass a codemod can
do — paying for it in advance is not.

Error and empty states are Persian too, including anything a user could see when
an upstream call fails. Log messages stay English.

## Rendering answers

`react-markdown` + `remark-math` + `rehype-katex`. KaTeX CSS is loaded once in
the root layout.

The answer card renders the structured result, not raw markdown: mode badge
(روش استاد / روش استاندارد), the correct option, the steps, then the sources.
Falling back to a wall of markdown loses the contractual distinction between the
teacher's method and the standard one.

## TTS text preparation (phase 6, design for it now)

Text sent to a speech model is not the text on screen. A separate function must:

- Convert LaTeX to spoken Persian (`$x^2$` → «ایکس به توان دو»)
- Convert digits to words
- Strip markdown syntax
- Handle Latin words embedded in Persian

Without this the audio is unusable. Keep it a pure function
(`string → string`) so it can be tested and iterated without calling a model.
