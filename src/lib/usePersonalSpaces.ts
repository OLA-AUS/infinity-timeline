// React hook: the personal spaces on this device, kept in step with IndexedDB.
//
// Changes are applied to state straight away (so the river updates at once) and then saved.
// If saving isn't possible, the spaces still work for this visit and `storageError` explains
// why — nothing is ever sent elsewhere as a fallback.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PersonalSpace } from './personal';
import { deleteSpace, loadSpaces, saveSpace } from './personalStore';

export interface PersonalSpaces {
  spaces: PersonalSpace[];
  loaded: boolean;
  storageError: string | null;
  /** Change one space with a pure function (src/lib/personal.ts) and save it. */
  update: (id: string, change: (s: PersonalSpace) => PersonalSpace) => void;
  /** Replace a space with an already-changed copy (e.g. after a vote) and save it. */
  put: (space: PersonalSpace) => void;
  add: (space: PersonalSpace) => void;
  remove: (id: string) => void;
}

export function usePersonalSpaces(): PersonalSpaces {
  const [spaces, setSpaces] = useState<PersonalSpace[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const spacesRef = useRef(spaces);
  spacesRef.current = spaces;

  useEffect(() => {
    let alive = true;
    loadSpaces()
      .then((s) => { if (alive) setSpaces(s); })
      .catch((e: Error) => { if (alive) setStorageError(`${e.message} Spaces you make will only last until you close this tab.`); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const persist = useCallback((space: PersonalSpace) => {
    saveSpace(space).catch((e: Error) => setStorageError(`Couldn’t save “${space.name}”: ${e.message}`));
  }, []);

  const put = useCallback((space: PersonalSpace) => {
    setSpaces((all) => (all.some((s) => s.id === space.id) ? all.map((s) => (s.id === space.id ? space : s)) : [...all, space]));
    persist(space);
  }, [persist]);

  const update = useCallback((id: string, change: (s: PersonalSpace) => PersonalSpace) => {
    const current = spacesRef.current.find((s) => s.id === id);
    if (!current) return;
    const next = change(current);
    if (next === current) return;
    spacesRef.current = spacesRef.current.map((s) => (s.id === id ? next : s)); // so quick successive edits stack up
    put(next);
  }, [put]);

  const add = useCallback((space: PersonalSpace) => {
    spacesRef.current = [...spacesRef.current, space];
    put(space);
  }, [put]);

  const remove = useCallback((id: string) => {
    spacesRef.current = spacesRef.current.filter((s) => s.id !== id);
    setSpaces((all) => all.filter((s) => s.id !== id));
    deleteSpace(id).catch((e: Error) => setStorageError(`Couldn’t delete the space: ${e.message}`));
  }, []);

  return { spaces, loaded, storageError, update, put, add, remove };
}
