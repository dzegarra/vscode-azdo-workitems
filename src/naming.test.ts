import { describe, expect, it } from 'vitest';
import {
  branchBelongsToWorkItem,
  workItemIdFromBranch,
  branchTypeFor,
  buildBranchName,
  buildPrDescription,
  buildPrTitle,
  isValidModule,
  parseBranchName,
  slugify,
} from './naming';

describe('slugify', () => {
  it('converts a title to kebab-case', () => {
    expect(slugify('Network Restart Button')).toBe('network-restart-button');
    expect(slugify('[PMUI] Add card to page!')).toBe('pmui-add-card-to-page');
    expect(slugify('Configuración de válvula')).toBe('configuracion-de-valvula');
  });

  it('cuts long titles on a word boundary', () => {
    const slug = slugify('Plunger lift control page triggers widget with a very long description');
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug).toBe('plunger-lift-control-page-triggers-widget-with-a');
  });
});

describe('branch names', () => {
  it('maps the work item type to the branch type', () => {
    const mapping = { Bug: 'bugfix' };
    expect(branchTypeFor('Bug', mapping)).toBe('bugfix');
    expect(branchTypeFor('Product Backlog Item', mapping)).toBe('feature');
  });

  it('builds branch names following the convention', () => {
    expect(buildBranchName('bugfix', 'fui-users', 1234, 'bug-fix-name')).toBe('bugfix/fui-users/1234-bug-fix-name');
    expect(buildBranchName('feature', 'pmui-dashboard', 999, 'Add card to page')).toBe(
      'feature/pmui-dashboard/999-add-card-to-page'
    );
  });

  it('parses branch names', () => {
    expect(parseBranchName('feature/fui-admin/5641-network-restart-button')).toEqual({
      type: 'feature',
      module: 'fui-admin',
      id: 5641,
      slug: 'network-restart-button',
    });
    expect(parseBranchName('refs/heads/bugfix/fui-common/66499-datagrid-columns-width')?.id).toBe(66499);
    expect(parseBranchName('develop')).toBeUndefined();
    expect(parseBranchName('10028_Change_Useless_Connected_Device_dropdown')).toBeUndefined();
  });

  it('matches branches with work items', () => {
    expect(branchBelongsToWorkItem('feature/fui-common/9876-dialog-alerts', 9876)).toBe(true);
    expect(branchBelongsToWorkItem('feature/fui-common/98760-dialog-alerts', 9876)).toBe(false);
  });

  it('validates module names', () => {
    expect(isValidModule('fui-apps-artificial-lift')).toBe(true);
    expect(isValidModule('FUI Apps')).toBe(false);
    expect(isValidModule('fui--apps')).toBe(false);
  });
});

describe('pull requests', () => {
  it('builds titles following the convention', () => {
    expect(buildPrTitle([123], 'Data Collection', 'Logs can be requested using a date range')).toBe(
      '[123] Data Collection: Logs can be requested using a date range'
    );
    expect(buildPrTitle([123, 554, 123], 'FUI Administration', ' Show the network configuration ')).toBe(
      '[123,554] FUI Administration: Show the network configuration'
    );
  });

  it('lists commits in the description', () => {
    expect(buildPrDescription(['Created component A', 'Updated hook B'])).toBe(
      '- Created component A\n- Updated hook B'
    );
  });
});

describe('workItemIdFromBranch', () => {
  it('reads the ID of the branches that follow the convention', () => {
    expect(workItemIdFromBranch('feature/fui-admin/5641-network-restart-button')).toBe(5641);
    expect(workItemIdFromBranch('refs/heads/bugfix/fui-admin/66280-accesspointlabel')).toBe(66280);
    expect(workItemIdFromBranch('bugfix/fui-admin/66280')).toBe(66280);
  });

  it('reads the ID of the branches of colleagues that do not follow it exactly', () => {
    expect(workItemIdFromBranch('feature/MA/60800_unit_config_for_rates_multiplier')).toBe(60800);
    expect(workItemIdFromBranch('fetaure/fui-apps-artificial-lift/59494-plunger-control-last-arrivals')).toBe(59494);
    expect(workItemIdFromBranch('feature/apps/65945-allow-to-select-unit-preset')).toBe(65945);
  });

  it('finds no work item in other branches', () => {
    for (const branch of ['develop', 'main', 'release/1.2', 'feature/dark-mode', 'hotfix/v2/some-fix', '123-fix']) {
      expect(workItemIdFromBranch(branch)).toBeUndefined();
    }
  });
});
