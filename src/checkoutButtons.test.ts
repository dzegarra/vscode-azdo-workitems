import { describe, expect, it } from 'vitest';
import { checkoutButton } from './checkoutButtons';

const base = {
  kind: 'review' as const,
  id: 12,
  mainAttributes: 'data-action="checkoutReviewRequest" data-pr="12"',
  title: 'Go',
};

describe('checkoutButton ...', () => {
  it('asks for the picker of the checkout actions, with an ellipsis (the picker does not open below the button)', () => {
    const html = checkoutButton(base);
    expect(html).toContain('data-action="checkoutMenu" data-kind="review" data-id="12"');
    expect(html).toContain('title="More checkout options" aria-label="More checkout options"');
    expect(html).toContain('<circle cx="3.5" cy="8" r="1"/>');
    expect(html).not.toContain('m4 6.5 4 4 4-4');
  });

  it('is not a popup of the button: no aria-haspopup, aria-expanded or aria-controls', () => {
    for (const html of [
      checkoutButton(base),
      checkoutButton({ ...base, worktree: '/w/x' }),
      checkoutButton({ ...base, iconOnly: true, branch: 'b' }),
    ]) {
      expect(html).not.toMatch(/aria-(haspopup|expanded|controls)/);
      expect(html).not.toContain('toggleMenu');
    }
  });

  it('uses the worktree variant when a worktree has the branch (Rule CARD-BTN-2)', () => {
    const html = checkoutButton({ ...base, worktree: '/w/x' });
    expect(html).toContain('Open worktree</button>');
    expect(html).toContain('data-action="worktreeMenu" data-kind="review" data-id="12"');
    expect(html).toContain('title="More worktree options"');
  });

  it('branch rows: icons, with the branch in the labels and in the data of the ellipsis', () => {
    const html = checkoutButton({ ...base, kind: 'workItem', iconOnly: true, branch: 'feature/a' });
    expect(html).toContain('aria-label="Checkout feature/a"');
    expect(html).toContain('aria-label="More checkout options of feature/a"');
    expect(html).toContain('data-action="checkoutMenu" data-kind="workItem" data-id="12" data-branch="feature/a"');
    expect(html).toContain('class="button caret small"');
  });
});
