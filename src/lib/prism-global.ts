/**
 * Prism global bootstrap.
 *
 * Prism's language components (`prismjs/components/*` and `prism-svelte`) read
 * the grammar registry from the bare global `Prism`, not from an import. This
 * module exists so that global is in place *before* those components evaluate:
 * import it first, then the components — ES modules evaluate their imports in
 * source order, so the ordering in `$lib/prism.ts` is load-bearing.
 */
import Prism from 'prismjs';

const scope = globalThis as typeof globalThis & { Prism?: typeof Prism };
scope.Prism = Prism;

// We highlight explicitly in `$lib/markdown.ts`; never auto-scan the page.
Prism.manual = true;

export default Prism;
