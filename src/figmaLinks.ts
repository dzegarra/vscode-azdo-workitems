/** Figma links found in the rich text fields of work items. Pure, so no "vscode" import */

export interface FigmaLink {
  url: string;
  /** "design", "file", "proto", "board", "make"… */
  kind: string;
  fileKey: string;
  /** File name, as shown in the URL ("PID", "Configuration as I/O Concept") */
  name: string;
  /** Frame or layer the link points to, e.g. "44247-78759" */
  nodeId?: string;
}

/** Kinds the Figma extension for VS Code can open; the others (prototypes, FigJam, Make) open in the browser */
const VSCODE_KINDS = ['design', 'file'];

const FIGMA_URL = /https:\/\/(?:[\w-]+\.)?figma\.com\/[a-z]+\/[A-Za-z0-9]+[^\s"'<>]*/g;

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, '&');
}

export function parseFigmaUrl(url: string): FigmaLink | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !(host === 'figma.com' || host.endsWith('.figma.com'))) {
    return undefined;
  }
  const [, kind, fileKey, rawName] = parsed.pathname.split('/');
  if (!kind || !fileKey) {
    return undefined;
  }
  let name = fileKey;
  if (rawName) {
    try {
      name = decodeURIComponent(rawName).replace(/-/g, ' ');
    } catch {
      name = rawName;
    }
  }
  return { url: parsed.href, kind, fileKey, name, nodeId: parsed.searchParams.get('node-id') ?? undefined };
}

/** Figma links of the HTML (in links or plain text), without duplicates (same file and node) */
export function findFigmaLinks(html: string): FigmaLink[] {
  const links = new Map<string, FigmaLink>();
  for (const [match] of html.matchAll(FIGMA_URL)) {
    // In plain text, the punctuation ending a sentence is not part of the URL
    const link = parseFigmaUrl(decodeEntities(match).replace(/[.,;:!?)\]]+$/, ''));
    if (link && !links.has(`${link.fileKey}#${link.nodeId ?? ''}`)) {
      links.set(`${link.fileKey}#${link.nodeId ?? ''}`, link);
    }
  }
  return [...links.values()];
}

export function canOpenInVsCode(link: Pick<FigmaLink, 'kind'>): boolean {
  return VSCODE_KINDS.includes(link.kind);
}
