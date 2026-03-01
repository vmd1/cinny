import React, { MouseEventHandler, forwardRef, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Text,
  config,
  toRem,
} from 'folds';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAtomValue } from 'jotai';
import FocusTrap from 'focus-trap-react';
import { JoinRule } from 'matrix-js-sdk';
import { factoryRoomIdByActivity } from '../../../utils/sort';
import {
  NavCategory,
  NavCategoryHeader,
  NavEmptyCenter,
  NavEmptyLayout,
} from '../../../components/nav';
import {
  getExplorePath,
  getHomeRoomPath,
} from '../../pathUtils';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import { useHomeRooms } from './useHomeRooms';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { VirtualTile } from '../../../components/virtualizer';
import { RoomNavItem } from '../../../features/room-nav';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { PageNav, PageNavHeader, PageNavContent } from '../../../components/page';
import { useRoomsUnread } from '../../../state/hooks/unread';
import { markAsRead } from '../../../utils/notifications';
import { stopPropagation } from '../../../utils/keyboard';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import {
  FavoriteRoomTag,
  LowPriorityRoomTag,
  hasRoomTag,
  useRoomTagVersion,
} from '../../../features/room-nav/roomTags';
import { RoomAvatar, RoomIcon } from '../../../components/room-avatar';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { getRoomAvatarUrl } from '../../../utils/room';

type RoomListSection = 'inbox' | 'unread' | 'low_priority' | 'favorites';

const SECTION_ITEMS: { section: RoomListSection; label: string }[] = [
  { section: 'inbox', label: 'Inbox' },
  { section: 'unread', label: 'Unread' },
  { section: 'low_priority', label: 'Low Priority' },
];

type HomeMenuProps = {
  requestClose: () => void;
};
const HomeMenu = forwardRef<HTMLDivElement, HomeMenuProps>(({ requestClose }, ref) => {
  const orphanRooms = useHomeRooms();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const unread = useRoomsUnread(orphanRooms, roomToUnreadAtom);
  const mx = useMatrixClient();

  const handleMarkAsRead = () => {
    if (!unread) return;
    orphanRooms.forEach((rId) => markAsRead(mx, rId, hideActivity));
    requestClose();
  };

  return (
    <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        <MenuItem
          onClick={handleMarkAsRead}
          size="300"
          after={<Icon size="100" src={Icons.CheckTwice} />}
          radii="300"
          aria-disabled={!unread}
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Mark as Read
          </Text>
        </MenuItem>
      </Box>
    </Menu>
  );
});

function HomeHeader() {
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  return (
    <>
      <PageNavHeader>
        <Box alignItems="Center" grow="Yes" gap="300">
          <Box grow="Yes">
            <Text size="H4" truncate>
              Home
            </Text>
          </Box>
          <Box>
            <IconButton
              aria-pressed={!!menuAnchor}
              variant="Background"
              onClick={handleOpenMenu}
            >
              <Icon src={Icons.VerticalDots} size="200" />
            </IconButton>
          </Box>
        </Box>
      </PageNavHeader>
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        align="End"
        offset={6}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => setMenuAnchor(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
              isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
              escapeDeactivates: stopPropagation,
            }}
          >
            <HomeMenu requestClose={() => setMenuAnchor(undefined)} />
          </FocusTrap>
        }
      />
    </>
  );
}

function HomeSectionFilters({
  section,
  onSectionChange,
}: {
  section: RoomListSection;
  onSectionChange: (section: RoomListSection) => void;
}) {
  return (
    <Box gap="200" wrap="Wrap" style={{ padding: `${config.space.S100} ${config.space.S100}` }}>
      {SECTION_ITEMS.map((item) => (
        <Chip
          key={item.section}
          variant={section === item.section ? 'Primary' : 'SurfaceVariant'}
          radii="Pill"
          size="400"
          onClick={() => onSectionChange(item.section)}
        >
          {item.label}
        </Chip>
      ))}
    </Box>
  );
}

function HomeEmpty() {
  const navigate = useNavigate();

  return (
    <NavEmptyCenter>
      <NavEmptyLayout
        icon={<Icon size="600" src={Icons.Hash} />}
        title={
          <Text size="H5" align="Center">
            No Rooms
          </Text>
        }
        content={
          <Text size="T300" align="Center">
            You do not have any rooms yet.
          </Text>
        }
        options={
          <Button
            onClick={() => navigate(getExplorePath())}
            variant="Secondary"
            fill="Soft"
            size="300"
          >
            <Text size="B300" truncate>
              Explore Community Rooms
            </Text>
          </Button>
        }
      />
    </NavEmptyCenter>
  );
}

function HomeFavoritesGrid({ roomIds }: { roomIds: string[] }) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const navigate = useNavigate();

  if (roomIds.length === 0) return null;

  return (
    <Box
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: config.space.S200,
      }}
    >
        {roomIds.map((roomId) => {
          const room = mx.getRoom(roomId);
          if (!room) return null;

          return (
            <Box
              as="button"
              key={roomId}
              onClick={() => navigate(getHomeRoomPath(getCanonicalAliasOrRoomId(mx, roomId)))}
              direction="Column"
              alignItems="Center"
              gap="100"
              style={{
                width: '100%',
                minWidth: 0,
                border: 0,
                borderRadius: config.radii.R400,
                background: 'transparent',
                padding: config.space.S100,
                cursor: 'pointer',
              }}
            >
              <Avatar size="500" radii="Pill">
                <RoomAvatar
                  roomId={room.roomId}
                  src={getRoomAvatarUrl(mx, room, 96, useAuthentication)}
                  alt={room.name}
                  renderFallback={() => (
                    <RoomIcon joinRule={room.getJoinRule() ?? JoinRule.Restricted} size="100" />
                  )}
                />
              </Avatar>
              <Text size="T200" align="Center" truncate>
                {room.name}
              </Text>
            </Box>
          );
        })}
    </Box>
  );
}

export function Home() {
  const mx = useMatrixClient();
  useNavToActivePathMapper('home');
  const scrollRef = useRef<HTMLDivElement>(null);
  const rooms = useHomeRooms();
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const navigate = useNavigate();
  const [section, setSection] = useState<RoomListSection>('inbox');
  const roomTagVersion = useRoomTagVersion(mx, rooms);

  const selectedRoomId = useSelectedRoom();

  const favoriteRoomIds = useMemo(
    () =>
      rooms.filter((roomId) => {
        const room = mx.getRoom(roomId);
        return room ? hasRoomTag(room, FavoriteRoomTag) : false;
      }),
    [mx, roomTagVersion, rooms]
  );
  const filteredRooms = useMemo(() => {
    if (section === 'inbox') return rooms;

    if (section === 'unread') {
      return rooms.filter((roomId) => roomToUnread.has(roomId));
    }

    return rooms.filter((roomId) => {
      const room = mx.getRoom(roomId);
      if (!room) return false;

      if (section === 'favorites') {
        return hasRoomTag(room, FavoriteRoomTag);
      }

      return hasRoomTag(room, LowPriorityRoomTag);
    });
  }, [mx, rooms, roomTagVersion, roomToUnread, section]);

  const noRoomToDisplay = filteredRooms.length === 0;

  const sortedRooms = useMemo(() => {
    const items = Array.from(filteredRooms).sort(factoryRoomIdByActivity(mx));
    return items;
  }, [mx, filteredRooms]);

  const virtualizer = useVirtualizer({
    count: sortedRooms.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 82,
    overscan: 10,
  });

  return (
    <PageNav>
      <HomeHeader />
      <PageNavContent scrollRef={scrollRef}>
        <Box direction="Column" gap="200">
          <HomeFavoritesGrid roomIds={favoriteRoomIds} />
          <HomeSectionFilters section={section} onSectionChange={setSection} />
          {noRoomToDisplay ? (
            <HomeEmpty />
          ) : (
            <NavCategory>
              <div
                style={{
                  position: 'relative',
                  height: virtualizer.getTotalSize(),
                }}
              >
                {virtualizer.getVirtualItems().map((vItem) => {
                  const roomId = sortedRooms[vItem.index];
                  const room = mx.getRoom(roomId);
                  if (!room) return null;
                  const selected = selectedRoomId === roomId;

                  return (
                    <VirtualTile
                      virtualItem={vItem}
                      key={vItem.index}
                      ref={virtualizer.measureElement}
                    >
                      <RoomNavItem
                        room={room}
                        selected={selected}
                        showAvatar
                        direct={false}
                        linkPath={getHomeRoomPath(getCanonicalAliasOrRoomId(mx, roomId))}
                        notificationMode={getRoomNotificationMode(notificationPreferences, room.roomId)}
                      />
                    </VirtualTile>
                  );
                })}
              </div>
            </NavCategory>
          )}
        </Box>
      </PageNavContent>
    </PageNav>
  );
}
