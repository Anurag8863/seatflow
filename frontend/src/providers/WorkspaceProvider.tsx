import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Building } from '@/lib/types';
import { useAuth } from './AuthProvider';

const STORAGE_KEY = 'seatflow-workspace';

interface WorkspaceContextValue {
  buildings: Building[];
  isLoading: boolean;
  buildingId: string | null;
  floorId: string | null;
  building: Building | null;
  floor: Building['floors'][number] | null;
  setBuilding: (buildingId: string) => void;
  setFloor: (floorId: string) => void;
}

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

function readStored(): { buildingId: string | null; floorId: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as { buildingId: string | null; floorId: string | null };
  } catch {
    /* ignore malformed or blocked storage */
  }
  return { buildingId: null, floorId: null };
}

/**
 * Holds the "which office am I looking at" selection shared by the header
 * selector and the seating plan, and remembers it between visits.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const [selection, setSelection] = React.useState(readStored);

  const { data: buildings = [], isLoading } = useQuery({
    queryKey: ['buildings'],
    queryFn: async () => (await api.get<Building[]>('/buildings')).data,
    enabled: status === 'authenticated',
    staleTime: 5 * 60 * 1000,
  });

  // Fall back to the first building/floor whenever the stored ids no longer exist.
  const building =
    buildings.find((item) => item.id === selection.buildingId) ?? buildings[0] ?? null;
  const floor =
    building?.floors.find((item) => item.id === selection.floorId) ?? building?.floors[0] ?? null;

  React.useEffect(() => {
    if (!building || !floor) return;
    if (selection.buildingId === building.id && selection.floorId === floor.id) return;
    const next = { buildingId: building.id, floorId: floor.id };
    setSelection(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* selection simply will not persist */
    }
  }, [building, floor, selection.buildingId, selection.floorId]);

  const persist = React.useCallback((next: { buildingId: string | null; floorId: string | null }) => {
    setSelection(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* selection simply will not persist */
    }
  }, []);

  const setBuilding = React.useCallback(
    (buildingId: string) => {
      const target = buildings.find((item) => item.id === buildingId);
      persist({ buildingId, floorId: target?.floors[0]?.id ?? null });
    },
    [buildings, persist],
  );

  const setFloor = React.useCallback(
    (floorId: string) => {
      const owner = buildings.find((item) => item.floors.some((entry) => entry.id === floorId));
      persist({ buildingId: owner?.id ?? selection.buildingId, floorId });
    },
    [buildings, persist, selection.buildingId],
  );

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      buildings,
      isLoading,
      buildingId: building?.id ?? null,
      floorId: floor?.id ?? null,
      building,
      floor,
      setBuilding,
      setFloor,
    }),
    [buildings, isLoading, building, floor, setBuilding, setFloor],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = React.useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used inside a WorkspaceProvider');
  return context;
}
