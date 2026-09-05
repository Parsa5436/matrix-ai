/** The digits a Persian reader expects. Indexable by value: PERSIAN_DIGITS[7] === "۷". */
export const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/**
 * ASCII digits → Persian, anywhere they appear in a string.
 *
 * The one implementation on purpose. `Intl.NumberFormat("fa-IR")` does the same job for a
 * number and had grown two separate copies, but it also inserts a thousands separator the
 * corpus never uses — so counts rendered through it drifted from labels rendered through
 * this. Numbers reach it as `toPersianDigits(String(n))`.
 */
export const toPersianDigits = (text: string) =>
	text.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
