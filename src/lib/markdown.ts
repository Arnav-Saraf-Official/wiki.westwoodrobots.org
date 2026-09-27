/**
 * Markdown → HTML for dynamic wiki content.
 *
 * Static docs are compiled by mdsvex at build time; content fetched from the
 * Apps Script API arrives as raw markdown, so it is rendered here instead.
 * Runs on both the server (load functions) and the client (editor preview).
 *
 * Safety: raw HTML in the source is escaped rather than passed through, and
 * link/image URLs are restricted to relative paths, `#` anchors and
 * http/https/mailto/tel — plus inline `data:image/...` URLs, which is how
 * pasted images are stored inside a document. So a document cannot inject
 * scripts or `javascript:` URLs into the page.
 *
 * Code blocks whose language is recognised are highlighted with Prism (see
 * `$lib/prism.ts`); the token markup matches what mdsvex emits for static docs.
 */
import { Marked, type Token, type Tokens } from 'marked';
import Prism from '$lib/prism';

const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;
/** Inline images: raster formats only, so an SVG cannot smuggle script markup. */
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,/i;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Returns a safe href, or null when the URL uses a scheme we do not allow.
 * `image` additionally permits inline `data:image/...` URLs.
 */
function safeHref(href: string | null | undefined, { image = false } = {}): string | null {
	const value = (href ?? '').trim();
	if (!value) return null;
	if (image && SAFE_DATA_IMAGE.test(value)) return value;
	if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
		return SAFE_SCHEME.test(value) ? value : null;
	}
	return value;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/** Recognised frontmatter keys; any other `key: value` is kept too. */
export interface DocMeta {
	title?: string;
	description?: string;
	/** Who wrote the page — shown in the document header. */
	author?: string;
	/** Path of the page to offer as "previous" (overrides sibling order). */
	prev?: string;
	/** Path of the page to offer as "next" (overrides sibling order). */
	next?: string;
	order?: number;
	[k: string]: unknown;
}

const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Minimal `key: value` frontmatter parser — enough for titles and links. */
function parseFrontmatterBlock(block: string): DocMeta {
	const meta: DocMeta = {};
	for (const rawLine of block.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const separator = line.indexOf(':');
		if (separator === -1) continue;
		const key = line.slice(0, separator).trim();
		let value = line.slice(separator + 1).trim();
		if (!key || !value) continue;
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		meta[key] = key === 'order' && value !== '' ? Number(value) : value;
	}
	return meta;
}

/**
 * Splits a document into its frontmatter metadata and its body. Documents
 * without a `---` block return empty metadata and the source unchanged.
 */
export function parseFrontmatter(source: string | null | undefined): {
	meta: DocMeta;
	body: string;
} {
	const text = source ?? '';
	const match = FRONTMATTER_RE.exec(text);
	if (!match) return { meta: {}, body: text };
	return { meta: parseFrontmatterBlock(match[1]), body: text.slice(match[0].length) };
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

const markdown = new Marked({ gfm: true, breaks: false });

markdown.use({
	walkTokens(token: Token) {
		if (token.type === 'link' || token.type === 'image') {
			const link = token as Tokens.Link | Tokens.Image;
			link.href = safeHref(link.href, { image: token.type === 'image' }) ?? '#';
		}
	},
	renderer: {
		// Render raw HTML as literal text instead of injecting it.
		html({ text }: Tokens.HTML | Tokens.Tag): string {
			return escapeHtml(text);
		},
		// Highlight fenced code blocks when a known language is given.
		code({ text, lang }: Tokens.Code): string {
			const language = (lang ?? '').trim().split(/\s+/)[0].toLowerCase();
			const grammar = language ? Prism.languages[language] : undefined;
			if (grammar) {
				const highlighted = Prism.highlight(text, grammar, language);
				return `<pre class="language-${escapeHtml(language)}"><code class="language-${escapeHtml(language)}">${highlighted}</code></pre>\n`;
			}
			return `<pre><code>${escapeHtml(text)}</code></pre>\n`;
		}
	}
});

/** Renders markdown to HTML. Never throws — an unparseable document degrades to escaped text. */
export function renderMarkdown(source: string | null | undefined): string {
	if (!source) return '';
	try {
		return markdown.parse(parseFrontmatter(source).body, { async: false }) as string;
	} catch {
		return `<p>${escapeHtml(source)}</p>`;
	}
}

/** First `# heading` in the body, used as a fallback title (frontmatter ignored). */
export function extractTitle(source: string | null | undefined): string | null {
	if (!source) return null;
	const match = /^#{1,3}\s+(.+)$/m.exec(parseFrontmatter(source).body);
	return match ? match[1].trim() : null;
}

/** First non-heading, non-empty paragraph — shown as a card summary. */
export function extractSummary(source: string | null | undefined, max = 140): string | null {
	if (!source) return null;
	for (const block of parseFrontmatter(source).body.split(/\r?\n\s*\r?\n/)) {
		const line = block.trim();
		if (!line || line.startsWith('#') || line.startsWith('```')) continue;
		const text = line
			.replace(/[#>*_`~[\]()!-]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (text) return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
	}
	return null;
}

/** Human-friendly label for a file name: `match-log.md` → `Match log`. */
export function fileLabel(name: string): string {
	const base = name.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();
	return base ? base.charAt(0).toUpperCase() + base.slice(1) : name;
}

/** Whether a file name is the section index (`index.md`, case-insensitive). */
export function isIndexName(name: string): boolean {
	return /^index\.md$/i.test(name);
}
