/**
 * Plain-English formatting for the client-facing reports.
 *
 * Turns rank numbers and change deltas into words a non-technical reader
 * understands without a legend — "#3" becomes "3rd place", "+3" becomes
 * "Up 3 spots". Convention (same as the rest of the reports): a LOWER rank
 * number is better, so a POSITIVE `change`/`improvement` means the keyword
 * moved UP toward #1.
 */

/** "1st", "2nd", "3rd", "4th"… — the ordinal for a rank position. */
export function ordinal(n: number): string {
  const abs = Math.abs(Math.round(n));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  let suffix = "th";
  if (mod100 < 11 || mod100 > 13) {
    if (mod10 === 1) suffix = "st";
    else if (mod10 === 2) suffix = "nd";
    else if (mod10 === 3) suffix = "rd";
  }
  return `${abs}${suffix}`;
}

/** "2nd place" for a ranked keyword, or "not ranking yet" when there's no rank. */
export function placeText(n: number | null | undefined): string {
  return n == null ? "not ranking yet" : `${ordinal(n)} place`;
}

/** Tight form for table cells and chips: "2nd" or "—" when unranked. */
export function placeShort(n: number | null | undefined): string {
  return n == null ? "—" : ordinal(n);
}

function spots(n: number): string {
  return Math.abs(n) === 1 ? "spot" : "spots";
}

/** A change in words: "Up 3 spots" / "Down 2 spots" / "No change" / "New". */
export function movementText(change: number | null | undefined): string {
  if (change == null) return "New";
  if (change > 0) return `Up ${change} ${spots(change)}`;
  if (change < 0) return `Down ${Math.abs(change)} ${spots(change)}`;
  return "No change";
}

/** One-word direction for tiny spots: "up" / "down" / "same" / "new". */
export function movementWord(change: number | null | undefined): string {
  if (change == null) return "new";
  if (change > 0) return "up";
  if (change < 0) return "down";
  return "same";
}

/** Full sentence for a mover row:
 *  "Moved up 3 spots — was 5th, now 2nd place". */
export function moverSentence(
  first: number | null,
  current: number | null,
  improvement: number,
): string {
  const dir = improvement > 0 ? "up" : "down";
  const n = Math.abs(improvement);
  const fromTo =
    first != null && current != null
      ? ` — was ${ordinal(first)}, now ${placeText(current)}`
      : current != null
        ? ` — now ${placeText(current)}`
        : "";
  return `Moved ${dir} ${n} ${spots(improvement)}${fromTo}`;
}

/** Joins a count with a noun, pluralizing: countNoun(1, "phrase") → "1 phrase". */
export function countNoun(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** A run/check status in plain words: "success" → "Checked OK". */
export function checkStatusText(status: string): string {
  switch (status) {
    case "success":
      return "Checked OK";
    case "error":
      return "Couldn't check";
    case "pending":
      return "In progress";
    default:
      return status ? status[0].toUpperCase() + status.slice(1) : status;
  }
}
