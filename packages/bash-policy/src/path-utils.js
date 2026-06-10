import path from "node:path";
export function isInsidePath(candidatePath, parentPath) {
    const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
