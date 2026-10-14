import { BASE_PLANES, type Document, type FeatureGroup } from './model.ts';

export function hiddenGroupMembers(doc: Document): Set<string> {
  return new Set((doc.groups ?? []).filter((group) => !group.visible).flatMap((group) => group.members));
}

// Visibility is a display override; geometry references and individual eye states survive.
export function groupDisplayDocument(doc: Document): Document {
  const hidden = hiddenGroupMembers(doc);
  if (!hidden.size) return doc;
  const hide = <T extends { id: string; visible: boolean }>(item: T): T =>
    hidden.has(item.id) ? { ...item, visible: false } : item;
  return {
    ...doc,
    baseVisibility: Object.fromEntries(
      BASE_PLANES.map((p) => [p.id, doc.baseVisibility[p.id] && !hidden.has(p.id)]),
    ),
    planes: doc.planes.map(hide),
    pointSets: doc.pointSets.map(hide),
    curves: doc.curves.map(hide),
  };
}

export function pruneGroups(doc: Document): Document {
  if (!doc.groups) return doc;
  const ids = new Set(
    [...BASE_PLANES, ...doc.planes, ...doc.pointSets, ...doc.curves].map((item) => item.id),
  );
  return {
    ...doc,
    groups: doc.groups
      .map((group) => ({ ...group, members: group.members.filter((id) => ids.has(id)) }))
      .filter((group) => group.members.length),
  };
}

export function groupFeatures(doc: Document, members: string[], id: string, name: string): Document {
  const available = new Set([...doc.planes, ...doc.pointSets, ...doc.curves].map((item) => item.id));
  const selected = new Set(members.filter((member) => available.has(member)));
  if (selected.size < 2) return doc;
  const group: FeatureGroup = { id, name, visible: true, members: [...selected] };
  // Moving items out of a hidden folder must not reveal them unexpectedly.
  const display = groupDisplayDocument(doc);
  const retainVisibility = <T extends { id: string; visible: boolean }>(items: T[], shown: T[]) =>
    items.map((item, i) => (selected.has(item.id) ? shown[i] : item));
  return {
    ...doc,
    planes: retainVisibility(doc.planes, display.planes),
    pointSets: retainVisibility(doc.pointSets, display.pointSets),
    curves: retainVisibility(doc.curves, display.curves),
    groups: [
      ...(doc.groups ?? [])
        .map((existing) => ({
          ...existing,
          members: existing.members.filter((member) => !selected.has(member)),
        }))
        .filter((existing) => existing.members.length),
      group,
    ],
  };
}

export function ungroupFeatures(doc: Document, id: string): Document {
  const group = doc.groups?.find((group) => group.id === id);
  if (!group) return doc;
  const hidden = new Set(group.visible ? [] : group.members);
  const retainVisibility = <T extends { id: string; visible: boolean }>(item: T): T =>
    hidden.has(item.id) ? { ...item, visible: false } : item;
  return {
    ...doc,
    groups: doc.groups!.filter((group) => group.id !== id),
    baseVisibility: Object.fromEntries(
      BASE_PLANES.map((p) => [p.id, doc.baseVisibility[p.id] && !hidden.has(p.id)]),
    ),
    planes: doc.planes.map(retainVisibility),
    pointSets: doc.pointSets.map(retainVisibility),
    curves: doc.curves.map(retainVisibility),
  };
}
