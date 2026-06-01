export function getInitials(name?: string | null, email?: string | null) {
  const trimmedName = name?.trim();
  const source =
    trimmedName && trimmedName.length > 0
      ? trimmedName
      : (email?.split("@")[0] ?? "User");

  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
