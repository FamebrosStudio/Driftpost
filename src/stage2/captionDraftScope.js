const keyFor = (key, userId) => `${key}:${userId}`;

function read(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export function readStageSelection(userId) {
  const teamWorkflow = read(keyFor('driftpost-team-workflow', userId), false);
  const teamSelection = read(keyFor('driftpost-team-selection', userId), null);
  const selection = {
    type: read('driftpost-stage1-type', ''),
    brandKey: read('driftpost-stage1-brand', ''),
    platforms: read('driftpost-stage1-platforms', []),
    groups: read('driftpost-groups', []),
    groupId: read('driftpost-stage1-group', ''),
    teamWorkflow,
    crosspost: read(keyFor('driftpost-stage2-crosspost', userId), false),
    pinnedAccounts: read('driftpost-stage1-brand-accounts', {}),
  };
  if (teamWorkflow && teamSelection?.group?.id) {
    return {
      ...selection,
      type: 'existing_groups',
      brandKey: teamSelection.brandKey || '',
      groups: [teamSelection.group],
      groupId: teamSelection.group.id,
      platforms: [],
      pinnedAccounts: {},
    };
  }
  return selection;
}

function selectionFingerprint(selection) {
  return JSON.stringify({
    type: selection.type || '',
    brandKey: selection.brandKey || '',
    platforms: [...(selection.platforms || [])].sort(),
    groups: (selection.groups || []).map((group) => ({
      id: group.id || '',
      accountIds: [...(group.accountIds || [])].sort(),
      platforms: [...(group.platforms || [])].sort(),
    })).sort((a, b) => a.id.localeCompare(b.id)),
    groupId: selection.groupId || '',
    teamWorkflow: !!selection.teamWorkflow,
    crosspost: !!selection.crosspost,
    pinnedAccounts: selection.pinnedAccounts || {},
  });
}

export function loadCaptionDraft(userId, selection) {
  const fingerprint = selectionFingerprint(selection);
  const savedFingerprint = read(keyFor('driftpost-stage2-output-context', userId), '');
  if (savedFingerprint !== fingerprint) return {};
  return read(keyFor('driftpost-stage2-outputs', userId), {});
}

export function saveCaptionDraft(userId, selection, outputs) {
  try {
    localStorage.setItem(keyFor('driftpost-stage2-output-context', userId), JSON.stringify(selectionFingerprint(selection)));
    localStorage.setItem(keyFor('driftpost-stage2-outputs', userId), JSON.stringify(outputs || {}));
  } catch {}
}
