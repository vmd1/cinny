import { useAtomValue } from 'jotai';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { RoomSelector, useSelectedRooms } from '../../../state/hooks/roomList';
import { isRoom } from '../../../utils/room';
import { useCallback } from 'react';

export const useHomeRooms = () => {
  const mx = useMatrixClient();
  const selector: RoomSelector = useCallback((roomId) => isRoom(mx.getRoom(roomId)), [mx]);
  const rooms = useSelectedRooms(allRoomsAtom, selector);
  return rooms;
};
