/**
 * What the product calls itself, in one place.
 *
 * The product is named after the teacher it answers as: a student should never be in doubt
 * about whose method they are reading. The name reaches the page title, the login screen and
 * both system prompts, so a second teacher later is this file rather than a search.
 *
 * The per-topic voice is NOT here — that is `Teacher.personaPrompt` in the database, injected
 * by assemble(). This is only the name the assistant introduces itself by.
 */
export const TEACHER_NAME = "استاد مهدی یحیوی";

export const ASSISTANT_INTRO = `دستیار دیجیتال ${TEACHER_NAME}`;
