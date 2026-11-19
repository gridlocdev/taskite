import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../ios/${p}`, import.meta.url), 'utf8');

describe('the Xcode project', () => {
  it('names no Apple team: the team ID goes in the untracked signing.local.xcconfig', () => {
    const project = read('App/App.xcodeproj/project.pbxproj');
    expect(
      project,
      'Picking a team in Xcode wrote it into project.pbxproj. Remove the DEVELOPMENT_TEAM line and put ' +
        '"DEVELOPMENT_TEAM = <team ID>" in apps/ios/ios/signing.local.xcconfig instead.',
    ).not.toMatch(/DEVELOPMENT_TEAM|PROVISIONING_PROFILE/);
    for (const config of ['debug.xcconfig', 'release.xcconfig'])
      expect(read(config)).toContain('#include? "signing.local.xcconfig"');
    expect(read('.gitignore')).toMatch(/^signing\.local\.xcconfig$/m);
  });

  it('shows the Documents folder in the Files app', () => {
    const plist = read('App/App/Info.plist');
    for (const key of ['UIFileSharingEnabled', 'LSSupportsOpeningDocumentsInPlace'])
      expect(plist).toMatch(new RegExp(`<key>${key}</key>\\s*<true/>`));
  });
});
