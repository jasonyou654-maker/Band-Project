/**
 * GitHub Pages serves this project below the repository name, while the
 * application host serves it from the domain root. Keep internal links
 * portable between those two deployment targets.
 */
export function sitePath(path = "/") {
  if (process.env.NEXT_PUBLIC_STATIC_SITE !== "true") return path;
  return path === "/" ? "/Band-Project/" : `/Band-Project${path}`;
}
