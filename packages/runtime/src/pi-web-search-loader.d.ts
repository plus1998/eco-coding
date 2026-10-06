export type PiWebSearchExtensionFactory = (pi: unknown) => void | Promise<void>;

declare const piWebSearch: PiWebSearchExtensionFactory;

export default piWebSearch;
