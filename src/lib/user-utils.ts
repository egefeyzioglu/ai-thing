export function getInitials(name?: string | null, email?: string | null) {
  const trimmedName = name?.trim();
  const trimmedEmailName = email?.split("@")[0]?.trim();
  const source =
    trimmedName && trimmedName.length > 0
      ? trimmedName
      : trimmedEmailName && trimmedEmailName.length > 0
        ? trimmedEmailName
        : "User";

  return source
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .filter((char) => char !== undefined)
    .join("");
}
