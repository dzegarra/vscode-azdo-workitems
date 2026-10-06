import { describe, expect, it } from 'vitest';
import { imageMimeType, imageSources, isOrganizationUrl, replaceImageSources } from './richTextImages';

const ATTACHMENT =
  'https://dev.azure.com/ABB-PAMA-BVL/814d2323-fa38-46db-9485-ab17cc0911d5/_apis/wit/attachments/6cf157ea?fileName=image.png';

describe('rich text images', () => {
  it('finds the image sources, decoding the HTML entities', () => {
    const html = `<div><img src="${ATTACHMENT.replace('?', '?a=1&amp;')}" alt="x"><p>text</p>
      <img alt='y' src='https://example.com/logo.png'><img src="${ATTACHMENT.replace('?', '?a=1&amp;')}"></div>`;
    expect(imageSources(html)).toEqual([ATTACHMENT.replace('?', '?a=1&'), 'https://example.com/logo.png']);
  });

  it('replaces only the given sources', () => {
    const html = `<img src="${ATTACHMENT}" style="width:100px"><img src="https://example.com/logo.png">`;
    expect(replaceImageSources(html, new Map([[ATTACHMENT, 'data:image/png;base64,AAAA']]))).toBe(
      '<img src="data:image/png;base64,AAAA" style="width:100px"><img src="https://example.com/logo.png">'
    );
  });

  it('only trusts the URLs of the organization with the token', () => {
    expect(isOrganizationUrl(ATTACHMENT, 'ABB-PAMA-BVL')).toBe(true);
    expect(isOrganizationUrl('https://abb-pama-bvl.visualstudio.com/_apis/wit/attachments/1', 'ABB-PAMA-BVL')).toBe(
      true
    );
    expect(isOrganizationUrl('https://dev.azure.com/other-org/_apis/wit/attachments/1', 'ABB-PAMA-BVL')).toBe(false);
    expect(isOrganizationUrl('http://dev.azure.com/ABB-PAMA-BVL/x', 'ABB-PAMA-BVL')).toBe(false);
    expect(isOrganizationUrl('https://dev.azure.com.evil.io/ABB-PAMA-BVL/x', 'ABB-PAMA-BVL')).toBe(false);
    expect(isOrganizationUrl('not a url', 'ABB-PAMA-BVL')).toBe(false);
  });

  it('accepts only image responses', () => {
    expect(imageMimeType('image/png; api-version=7.1')).toBe('image/png');
    expect(imageMimeType('text/html; charset=utf-8')).toBeUndefined();
    expect(imageMimeType(null)).toBeUndefined();
  });
});
