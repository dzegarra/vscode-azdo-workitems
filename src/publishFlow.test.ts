import { describe, expect, it, vi } from 'vitest';
import { publishDraft } from './publishFlow';

function steps(confirmed: boolean) {
  const calls: string[] = [];
  return {
    calls,
    confirm: vi.fn((message: string) => {
      calls.push(`confirm: ${message}`);
      return Promise.resolve(confirmed);
    }),
    publish: vi.fn(() => Promise.resolve(void calls.push('publish'))),
    refresh: vi.fn(() => Promise.resolve(void calls.push('refresh'))),
  };
}

describe('publishDraft', () => {
  it('asks for confirmation, publishes and refreshes, in this order', async () => {
    const s = steps(true);
    expect(await publishDraft(13765, true, s)).toBe(true);
    expect(s.calls).toEqual(['confirm: Publish PR 13765? Reviewers will be notified.', 'publish', 'refresh']);
  });

  it('sends nothing when the user cancels', async () => {
    const s = steps(false);
    expect(await publishDraft(13765, true, s)).toBe(false);
    expect(s.publish).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it('refuses a PR that is not a draft, without asking', async () => {
    const s = steps(true);
    await expect(publishDraft(13765, false, s)).rejects.toThrow('not a draft');
    expect(s.confirm).not.toHaveBeenCalled();
  });

  it('does not refresh when publishing fails', async () => {
    const s = steps(true);
    s.publish.mockRejectedValueOnce(new Error('Azure DevOps 403'));
    await expect(publishDraft(1, true, s)).rejects.toThrow('403');
    expect(s.refresh).not.toHaveBeenCalled();
  });
});
