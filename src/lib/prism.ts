/**
 * Shared Prism instance for markdown code blocks.
 *
 * `./prism-global` must be imported before any language component so that the
 * global registry exists; keep that import first if this list ever changes.
 * Languages are imported as side effects that register themselves onto Prism.
 *
 * The same Prism instance is used on the server (load functions) and in the
 * browser (editor preview), so code blocks highlighted dynamically here match
 * the static docs mdsvex compiles with its own Prism pipeline.
 */
import Prism from './prism-global';

import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-glsl';
import 'prism-svelte';

export default Prism;
