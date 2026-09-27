/**
 * Static documentation ("as-is" markdown pages).
 *
 * Every `.md` file under `src/content/` is compiled by mdsvex into a Svelte
 * component at build time, and this module turns those files into a tree so
 * the site can mirror the on-disk organization: sections (directories) hold
 * pages (files). Because mdsvex compiles the markdown, a page can import and
 * render Svelte components and arbitrary TypeScript — an interactive
 * simulation is just a component used inside the markdown.
 *
 * Adding a page = dropping a `.md` file into `src/content/`. No registration.
 */
import type { Component } from 'svelte';
import { fileLabel, isIndexName } from '$lib/markdown';

export interface DocFrontmatter {
	title?: string;
	description?: string;
	order?: number;
	/** Page author, shown in the document header. */
	author?: string;
	/** Path (or section-relative name) of the page to link as previous/next. */
	prev?: string;
	next?: string;
	[k: string]: unknown;
}

export interface DocFile {
	type: 'file';
	/** File name with extension, e.g. `build-guide.md`. */
	name: string;
	/** Display title (frontmatter `title`, else derived from the file name). */
	title: string;
	/** Path relative to the content root, extension stripped, e.g. `robots/build-guide`. */
	path: string;
	/** Link target, e.g. `/wiki/robots/build-guide`. */
	href: string;
	description?: string;
	order?: number;
	author?: string;
	prev?: string;
	next?: string;
	/** Path of the section this file lives in; `''` for the root. */
	section: string;
	component: Component;
}

/** A section groups pages; it maps to a directory under `src/content/`. */
export interface DocSection {
	type: 'section';
	name: string;
	title: string;
	path: string;
	href: string;
	order?: number;
	children: DocNode[];
}

export type DocNode = DocFile | DocSection;

interface MarkdownModule {
	default: Component;
	metadata?: DocFrontmatter;
}

const modules = import.meta.glob('/src/content/**/*.md', { eager: true }) as Record<
	string,
	MarkdownModule
>;

const CONTENT_PREFIX = '/src/content/';

function titleCase(value: string): string {
	const spaced = value.replace(/[-_]+/g, ' ').trim();
	return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : value;
}

function sortNodes(nodes: DocNode[]): DocNode[] {
	return nodes.sort((a, b) => {
		if (a.type !== b.type) return a.type === 'section' ? -1 : 1;
		const orderA = a.order ?? Number.POSITIVE_INFINITY;
		const orderB = b.order ?? Number.POSITIVE_INFINITY;
		if (orderA !== orderB) return orderA - orderB;
		return a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
	});
}

function buildTree(): DocNode[] {
	const files = Object.entries(modules).map(([key, module]) => {
		const path = key.slice(CONTENT_PREFIX.length).replace(/\.md$/i, '');
		const segments = path.split('/');
		const name = `${segments[segments.length - 1]}.md`;
		return {
			segments,
			file: {
				type: 'file' as const,
				name,
				title: module.metadata?.title?.trim() || fileLabel(name),
				path,
				href: `/wiki/${path}`,
				description: module.metadata?.description,
				order: module.metadata?.order,
				author: module.metadata?.author,
				prev: module.metadata?.prev,
				next: module.metadata?.next,
				section: segments.slice(0, -1).join('/'),
				component: module.default
			}
		};
	});

	const root: DocSection = {
		type: 'section',
		name: '',
		title: 'Wiki',
		path: '',
		href: '/wiki',
		children: []
	};

	for (const { segments, file } of files) {
		let section = root;
		for (let i = 0; i < segments.length - 1; i++) {
			const segment = segments[i];
			const sectionPath = segments.slice(0, i + 1).join('/');
			let next = section.children.find(
				(child): child is DocSection => child.type === 'section' && child.name === segment
			);
			if (!next) {
				next = {
					type: 'section',
					name: segment,
					title: titleCase(segment),
					path: sectionPath,
					href: `/wiki/${sectionPath}`,
					children: []
				};
				section.children.push(next);
			}
			section = next;
		}
		section.children.push(file);
	}

	const sortRecursive = (section: DocSection) => {
		sortNodes(section.children);
		for (const child of section.children) {
			if (child.type === 'section') sortRecursive(child);
		}
	};
	sortRecursive(root);
	return root.children;
}

export const docsTree: DocNode[] = buildTree();

/** Finds a page by its extension-less path (`robots/build-guide`). */
export function findDoc(path: string): DocFile | undefined {
	const target = path.replace(/^\/+|\/+$/g, '').replace(/\.md$/i, '');
	return flatten(docsTree).find(
		(node): node is DocFile => node.type === 'file' && node.path === target
	);
}

/** Finds a section by its path (`robots`), or the root when the path is empty. */
export function findSection(path: string): DocSection | undefined {
	const target = path.replace(/^\/+|\/+$/g, '');
	const root: DocSection = {
		type: 'section',
		name: '',
		title: 'Wiki',
		path: '',
		href: '/wiki',
		children: docsTree
	};
	if (!target) return root;
	return flatten(docsTree).find(
		(node): node is DocSection => node.type === 'section' && node.path === target
	);
}

/** Whether a node is a section's `index.md` (the page shown for the section). */
export function isIndexFile(node: DocNode): node is DocFile {
	return node.type === 'file' && isIndexName(node.name);
}

/** The `index.md` page of a section, if it has one. */
export function indexFileOf(section: DocSection | undefined): DocFile | undefined {
	return section?.children.find(isIndexFile);
}

/**
 * The pages directly inside a section, in reading order. Index pages are left
 * out so they are not listed twice (the section itself is the index).
 */
export function sectionFiles(section: DocSection | undefined): DocFile[] {
	if (!section) return [];
	return section.children.filter(
		(node): node is DocFile => node.type === 'file' && !isIndexFile(node)
	);
}

/** All descendants of `nodes`, depth first. */
export function flatten(nodes: DocNode[]): DocNode[] {
	const out: DocNode[] = [];
	for (const node of nodes) {
		out.push(node);
		if (node.type === 'section') out.push(...flatten(node.children));
	}
	return out;
}

/** Total page count, shown on the home page. */
export const docCount = flatten(docsTree).filter((node) => node.type === 'file').length;
