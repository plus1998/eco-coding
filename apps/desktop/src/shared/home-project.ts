export const HOME_PROJECT_DISPLAY_NAME = "Home";

export const HOME_PROJECT_IMPORTED_AT = "1970-01-01T00:00:00.000Z";

function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

export function buildHomeProjectPath(homedir: string): string {
  const trimmed = normalizeProjectPath(homedir);
  return `${trimmed}/.eco/projects/home`;
}

export function isHomeProjectPath(projectPath: string, homeProjectPath: string): boolean {
  return normalizeProjectPath(projectPath) === normalizeProjectPath(homeProjectPath);
}
