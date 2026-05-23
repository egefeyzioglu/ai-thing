# AGENTS.md

## Development Guidelines

- Do not run `pnpm build` locally; it may cause errors.
- Verify changes with:
  - `pnpm typecheck`
  - `pnpm lint`
- Always use shadcn components where possible, installing them as needed.
- Use Tailwind CSS for styling.
- Use Prettier only on changed lines or newly created files.
  - Do not include unrelated Prettier churn in your changes.
