/**
 * Images of the rich text fields of work items (description, repro steps…). They are Azure DevOps
 * attachments that need authentication, which the webviews cannot send, so the extension downloads them
 * and embeds them as data URIs. Pure, so no "vscode" import
 */

const IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*("([^"]*)"|'([^']*)')/gi;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Sources of the <img> tags of the HTML, decoded (as they would be requested) and without duplicates */
export function imageSources(html: string): string[] {
  // Only one of the two groups (double or single quotes) is set
  const sources = [...html.matchAll(IMG_SRC)].map((match) => {
    const [, , double, single] = match as (string | undefined)[];
    return decodeEntities(double ?? single ?? '');
  });
  return [...new Set(sources.filter(Boolean))];
}

/** Replaces the sources of the <img> tags found in the map, keeping the others */
export function replaceImageSources(html: string, replacements: Map<string, string>): string {
  return html.replace(IMG_SRC, (tag: string, _attribute: string, double?: string, single?: string) => {
    const source = double ?? single ?? '';
    const replacement = replacements.get(decodeEntities(source));
    return replacement ? tag.replace(source, replacement) : tag;
  });
}

/**
 * True for URLs of the Azure DevOps organization. Only those may receive the user's token:
 * images hosted anywhere else are left untouched
 */
export function isOrganizationUrl(url: string, organization: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const org = organization.toLowerCase();
  const firstSegment = decodeURIComponent(parsed.pathname.split('/')[1] ?? '').toLowerCase();
  return (host === 'dev.azure.com' && firstSegment === org) || host === `${org}.visualstudio.com`;
}

/** "image/png; api-version=7.1" → "image/png". Undefined when it is not an image */
export function imageMimeType(contentType: string | null): string | undefined {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase();
  return mime?.startsWith('image/') ? mime : undefined;
}
