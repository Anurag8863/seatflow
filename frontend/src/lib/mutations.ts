import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from './api';
import type { SeatStatus, SeatingResult } from './types';

/**
 * Everything that changes seating data touches the same handful of caches, so
 * invalidation lives here rather than being repeated at every call site.
 */
const AFFECTED_QUERIES = ['dashboard', 'seats', 'employees', 'floor-plan', 'audit-logs', 'buildings', 'global-search'];

function useSeatingInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of AFFECTED_QUERIES) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

interface MutationOptions {
  onSuccess?: (result: SeatingResult) => void;
}

export function useAssignSeat(options: MutationOptions = {}) {
  const invalidate = useSeatingInvalidation();

  return useMutation({
    mutationFn: async (input: { seatId: string; employeeId: string }) =>
      (await api.post<SeatingResult>('/seats/' + input.seatId + '/assign', { employeeId: input.employeeId })).data,
    onSuccess: (result) => {
      invalidate();
      toast.success(result.summary);
      options.onSuccess?.(result);
    },
    onError: (error) => toast.error(errorMessage(error, 'The seat could not be assigned.')),
  });
}

export function useMoveEmployee(options: MutationOptions = {}) {
  const invalidate = useSeatingInvalidation();

  return useMutation({
    mutationFn: async (input: { employeeId: string; seatId: string }) =>
      (await api.post<SeatingResult>('/employees/' + input.employeeId + '/move', { seatId: input.seatId })).data,
    onSuccess: (result) => {
      invalidate();
      toast.success(result.summary);
      options.onSuccess?.(result);
    },
    onError: (error) => toast.error(errorMessage(error, 'The employee could not be moved.')),
  });
}

export function useReleaseSeat(options: MutationOptions = {}) {
  const invalidate = useSeatingInvalidation();

  return useMutation({
    mutationFn: async (input: { seatId: string }) =>
      (await api.post<SeatingResult>('/seats/' + input.seatId + '/release')).data,
    onSuccess: (result) => {
      invalidate();
      toast.success(result.summary);
      options.onSuccess?.(result);
    },
    onError: (error) => toast.error(errorMessage(error, 'The seat could not be released.')),
  });
}

export function useReleaseEmployeeSeat(options: MutationOptions = {}) {
  const invalidate = useSeatingInvalidation();

  return useMutation({
    mutationFn: async (input: { employeeId: string }) =>
      (await api.post<SeatingResult>('/employees/' + input.employeeId + '/release')).data,
    onSuccess: (result) => {
      invalidate();
      toast.success(result.summary);
      options.onSuccess?.(result);
    },
    onError: (error) => toast.error(errorMessage(error, 'The seat could not be released.')),
  });
}

export function useSetSeatStatus(options: MutationOptions = {}) {
  const invalidate = useSeatingInvalidation();

  return useMutation({
    mutationFn: async (input: { seatId: string; status: Extract<SeatStatus, 'AVAILABLE' | 'RESERVED' | 'DISABLED'> }) =>
      (await api.patch<SeatingResult>('/seats/' + input.seatId + '/status', { status: input.status })).data,
    onSuccess: (result) => {
      invalidate();
      toast.success(result.summary);
      options.onSuccess?.(result);
    },
    onError: (error) => toast.error(errorMessage(error, 'The seat status could not be changed.')),
  });
}
