import { describe, expect, it, vi } from 'vitest';

/** Fake `vscode`: createTreeView returns an object whose badge can be read, as the real tree view keeps it */
const created = vi.hoisted(() => ({ views: [] as { badge?: unknown; dispose: () => void }[] }));
vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners: ((value: T) => void)[] = [];
    event = (listener: (value: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => undefined };
    };
    fire = (value?: T) => this.listeners.forEach((listener) => listener(value as T));
    dispose = () => undefined;
  }
  return {
    EventEmitter,
    TreeItem: class {
      constructor(public label: string) {}
    },
    TreeItemCollapsibleState: { None: 0 },
    ThemeIcon: class {
      constructor(public id: string) {}
    },
    ThemeColor: class {
      constructor(public id: string) {}
    },
    window: {
      createTreeView: () => {
        const view = { badge: undefined as unknown, dispose: () => undefined };
        created.views.push(view);
        return view;
      },
    },
  };
});

import { SummaryView } from './summaryView';

describe('SummaryView', () => {
  it('sets the badge at creation, with no webview view resolved, and updates it on changes', () => {
    const storeChanged = new (class {
      listener?: () => void;
      event = (listener: () => void) => {
        this.listener = listener;
        return { dispose: () => undefined };
      };
    })();
    let alerts = 2;
    const none = { onDidChange: () => ({ dispose: () => undefined }) };
    const view = new SummaryView({
      store: { onDidChange: storeChanged.event, withAlerts: { length: 0 }, pullRequestRuns: [] } as never,
      reviews: { ...none, models: () => [{ isRequired: true, urgency: 'fresh' }] } as never,
      myPullRequests: { ...none, models: () => ({ items: [] }) } as never,
    });
    Object.defineProperty((view as unknown as { sources: { store: object } }).sources.store, 'withAlerts', {
      get: () => ({ length: alerts }),
    });
    view.update();
    expect(created.views[0].badge).toEqual({
      value: 3,
      tooltip: '2 work items need attention, 1 pull request is waiting for your review',
    });
    alerts = 0;
    storeChanged.listener?.();
    expect(created.views[0].badge).toEqual({ value: 1, tooltip: '1 pull request is waiting for your review' });
    expect(view.getChildren().map((row) => row.id)).toEqual(['reviews']);
    expect(view.getChildren(view.getChildren()[0])).toEqual([]);
  });
});
