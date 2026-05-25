import type { ComponentType } from "react";

// Registry of versions that have an authored MDX body. Each entry lazily
// imports content/changelog/<version>.mdx, which the changelog page renders in
// place of the plain appcast bullets. To dress up a release:
//   1. add content/changelog/<version>.mdx (with `export const title = "..."`),
//   2. add a line here mapping that version to its import,
//   3. drop any screenshots in public/changelog/.
// Versions absent from this map fall back to their automatic appcast notes.
type ChangelogMdxModule = {
  default: ComponentType;
  title?: string;
};

export const changelogEntries: Record<
  string,
  () => Promise<ChangelogMdxModule>
> = {
  "0.1.34": () => import("@/content/changelog/0.1.34.mdx"),
};
