import { describe, expect, it } from 'vitest';
import { canOpenInVsCode, findFigmaLinks, parseFigmaUrl } from './figmaLinks';

describe('figma links', () => {
  it('parses design links like the Figma extension does', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/AbC123/PID?node-id=44247-78759&m=dev')).toEqual({
      url: 'https://www.figma.com/design/AbC123/PID?node-id=44247-78759&m=dev',
      kind: 'design',
      fileKey: 'AbC123',
      name: 'PID',
      nodeId: '44247-78759',
    });
    expect(parseFigmaUrl('https://www.figma.com/make/XyZ9/Configuration-as-I-O-Concept?t=1')).toMatchObject({
      kind: 'make',
      name: 'Configuration as I O Concept',
      nodeId: undefined,
    });
  });

  it('ignores URLs that are not Figma files', () => {
    expect(parseFigmaUrl('https://www.figma.com/')).toBeUndefined();
    expect(parseFigmaUrl('https://figma.com.evil.io/design/AbC/x')).toBeUndefined();
    expect(parseFigmaUrl('http://www.figma.com/design/AbC/x')).toBeUndefined();
  });

  it('finds the links of a description, in anchors and plain text, without duplicates', () => {
    const url = 'https://www.figma.com/design/AbC123/PID?node-id=1-2&amp;m=dev';
    const html = `<div>See <a href="${url}">${url}</a> and https://www.figma.com/design/AbC123/PID?node-id=3-4.
      Prototype: <a href='https://www.figma.com/make/XyZ9/Concept?fullscreen=1'>here</a></div>`;
    expect(findFigmaLinks(html).map((link) => [link.kind, link.nodeId])).toEqual([
      ['design', '1-2'],
      ['design', '3-4'],
      ['make', undefined],
    ]);
  });

  it('opens designs in VS Code and the rest in the browser', () => {
    expect(canOpenInVsCode({ kind: 'design' })).toBe(true);
    expect(canOpenInVsCode({ kind: 'file' })).toBe(true);
    expect(canOpenInVsCode({ kind: 'make' })).toBe(false);
    expect(canOpenInVsCode({ kind: 'proto' })).toBe(false);
  });
});
