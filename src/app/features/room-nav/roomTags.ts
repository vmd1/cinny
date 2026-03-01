import { MatrixClient, Room, RoomEvent, RoomEventHandlerMap } from 'matrix-js-sdk';
import { useEffect, useState } from 'react';
import { AccountDataEvent } from '../../../types/matrix/accountData';

export const FavoriteRoomTag = 'm.favourite';
export const LowPriorityRoomTag = 'm.lowpriority';

type RoomTagContent = {
  tags?: Record<string, Record<string, unknown>>;
};

const getRoomTagContent = (room: Room): RoomTagContent => {
  const event = room.accountData.get(AccountDataEvent.RoomTag);
  const content = event?.getContent<RoomTagContent>();

  if (!content || typeof content !== 'object') {
    return {};
  }

  return content;
};

const getRoomTags = (room: Room): Record<string, Record<string, unknown>> =>
  getRoomTagContent(room).tags ?? {};

export const hasRoomTag = (room: Room, tag: string): boolean => !!getRoomTags(room)[tag];

export const setRoomPriorityTag = async (
  mx: MatrixClient,
  roomId: string,
  tag: typeof FavoriteRoomTag | typeof LowPriorityRoomTag | undefined
) => {
  const room = mx.getRoom(roomId);
  if (!room) return;

  const tags = { ...getRoomTags(room) };

  delete tags[FavoriteRoomTag];
  delete tags[LowPriorityRoomTag];

  if (tag) {
    tags[tag] = {};
  }

  await mx.setRoomAccountData(roomId, AccountDataEvent.RoomTag, { tags });
};

export const useRoomTagVersion = (mx: MatrixClient, roomIds: string[]) => {
  const [version, setVersion] = useState(0);
  const idsKey = roomIds.join('|');

  useEffect(() => {
    const resolvedRoomIds = idsKey ? idsKey.split('|') : [];
    const roomHandlers = new Map<Room, RoomEventHandlerMap[RoomEvent.AccountData]>();

    resolvedRoomIds.forEach((roomId) => {
      const room = mx.getRoom(roomId);
      if (!room) return;

      const handler: RoomEventHandlerMap[RoomEvent.AccountData] = (event) => {
        if (event.getType() !== AccountDataEvent.RoomTag) return;
        setVersion((v) => v + 1);
      };

      room.on(RoomEvent.AccountData, handler);
      roomHandlers.set(room, handler);
    });

    return () => {
      roomHandlers.forEach((handler, room) => {
        room.removeListener(RoomEvent.AccountData, handler);
      });
    };
  }, [mx, idsKey]);

  return version;
};
