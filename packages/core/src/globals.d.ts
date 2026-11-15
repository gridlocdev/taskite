// The two web-platform globals the engine uses. Browsers and Node 22 both have them; declaring them here
// keeps the DOM and Node type libraries out of the engine.
declare function structuredClone<T>(value: T): T;
declare const crypto: { randomUUID(): string };
