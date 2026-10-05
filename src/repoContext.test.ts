import { describe, expect, it } from 'vitest';
import { parseAzdoRemote } from './repoContext';

const expected = {
  organization: 'ABB-PAMA-BVL',
  project: 'Flow Digital Architecture',
  repository: 'User_Interface',
};

describe('parseAzdoRemote', () => {
  it.each([
    'git@ssh.dev.azure.com:v3/ABB-PAMA-BVL/Flow%20Digital%20Architecture/User_Interface',
    'git@ssh.dev.azure.com:v3/ABB-PAMA-BVL/Flow Digital Architecture/User_Interface',
    'https://dev.azure.com/ABB-PAMA-BVL/Flow%20Digital%20Architecture/_git/User_Interface',
    'https://someone@dev.azure.com/ABB-PAMA-BVL/Flow%20Digital%20Architecture/_git/User_Interface',
    'https://ABB-PAMA-BVL.visualstudio.com/Flow%20Digital%20Architecture/_git/User_Interface',
  ])('parses %s', (url) => {
    expect(parseAzdoRemote(url)).toEqual(expected);
  });

  it('ignores other providers', () => {
    expect(parseAzdoRemote('git@github.com:org/repo.git')).toBeUndefined();
  });
});
