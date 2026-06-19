function hasLetters(value: string) {
  return /[A-Za-z]/.test(value);
}

function upperCaseLetters(value: string) {
  return value.replace(/[^A-Za-z]/g, "");
}

function isAllCapsName(value: string) {
  const letters = upperCaseLetters(value);
  return Boolean(letters) && letters === letters.toUpperCase();
}

function titleCaseWord(value: string) {
  return value.replace(/[A-Za-z]+/g, (part) => (
    part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
  ));
}

export function formatNameForMerge(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!hasLetters(trimmed) || !isAllCapsName(trimmed)) return trimmed;
  return titleCaseWord(trimmed);
}

export function firstNameForMerge(value: string) {
  return formatNameForMerge(value).split(/\s+/)[0] || "";
}
