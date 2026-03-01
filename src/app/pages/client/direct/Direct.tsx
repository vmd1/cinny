import React, { MouseEventHandler, forwardRef, useMemo, useRef, useState } from 'react';
import { JoinRule } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
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
import FocusTrap from 'focus-trap-react';
import { useNavigate } from 'react-router-dom';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { factoryRoomIdByActivity } from '../../../utils/sort';
import {
  NavButton,
  NavCategory,
  NavCategoryHeader,
  NavEmptyCenter,
  NavEmptyLayout,
  NavItem,
  NavItemContent,
} from '../../../components/nav';
import { getDirectCreatePath, getDirectRoomPath } from '../../pathUtils';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import { VirtualTile } from '../../../components/virtualizer';
import { RoomNavItem } from '../../../features/room-nav';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { useDirectRooms } from './useDirectRooms';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import { useRoomsUnread } from '../../../state/hooks/unread';
import { markAsRead } from '../../../utils/notifications';
import { stopPropagation } from '../../../utils/keyboard';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { useDirectCreateSelected } from '../../../hooks/router/useDirectSelected';
import {
  FavoriteRoomTag,
  LowPriorityRoomTag,
  hasRoomTag,
  useRoomTagVersion,
} from '../../../features/room-nav/roomTags';
import { RoomAvatar, RoomIcon } from '../../../components/room-avatar';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { getDirectRoomAvatarUrl } from '../../../utils/room';
import { nameInitials } from '../../../utils/common';

type RoomListSection = 'inbox' | 'unread' | 'low_priority' | 'favorites';

const SECTION_ITEMS: { section: RoomListSection; label: string }[] = [
  { section: 'inbox', label: 'Inbox' },
  { section: 'unread', label: 'Unread' },
  { section: 'low_priority', label: 'Low Priority' },
];

type DirectMenuProps = {
  requestClose: () => void;
};
const DirectMenu = forwardRef<HTMLDivElement, DirectMenuProps>(({ requestClose }, ref) => {
  const mx = useMatrixClient();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const orphanRooms = useDirectRooms();
  const unread = useRoomsUnread(orphanRooms, roomToUnreadAtom);

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

function DirectHeader() {
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
              Direct Messages
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
            <DirectMenu requestClose={() => setMenuAnchor(undefined)} />
          </FocusTrap>
        }
      />
    </>
  );
}

function DirectSectionFilters({
  section,
  onSectionChange,
}: {
  section: RoomListSection;
  onSectionChange: (section: RoomListSection) => void;
}) {
  return (
    <Box gap="200" wrap="Wrap">
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

function DirectEmpty() {
  const navigate = useNavigate();

  return (
    <NavEmptyCenter>
      <NavEmptyLayout
        icon={<Icon size="600" src={Icons.Mention} />}
        title={
          <Text size="H5" align="Center">
            No Direct Messages
          </Text>
        }
        content={
          <Text size="T300" align="Center">
            You do not have any direct messages yet.
          </Text>
        }
        options={
          <Button variant="Secondary" size="300" onClick={() => navigate(getDirectCreatePath())}>
            <Text size="B300" truncate>
              Direct Message
            </Text>
          </Button>
        }
      />
    </NavEmptyCenter>
  );
}

function DirectFavoritesGrid({ roomIds }: { roomIds: string[] }) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const navigate = useNavigate();

  if (roomIds.length === 0) return null;

  return (
    <Box direction="Column" gap="200">
      <Text size="L400">Favorites</Text>
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
              onClick={() => navigate(getDirectRoomPath(getCanonicalAliasOrRoomId(mx, roomId)))}
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
                  src={getDirectRoomAvatarUrl(mx, room, 96, useAuthentication)}
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
    </Box>
  );
}

export function Direct() {
  const mx = useMatrixClient();
  useNavToActivePathMapper('direct');
  const scrollRef = useRef<HTMLDivElement>(null);
  const directs = useDirectRooms();
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const navigate = useNavigate();
  const [section, setSection] = useState<RoomListSection>('inbox');
  const roomTagVersion = useRoomTagVersion(mx, directs);

  const createDirectSelected = useDirectCreateSelected();

  const selectedRoomId = useSelectedRoom();

  const favoriteDirectIds = useMemo(
    () =>
      directs.filter((roomId) => {
        const room = mx.getRoom(roomId);
        return room ? hasRoomTag(room, FavoriteRoomTag) : false;
      }),
    [mx, roomTagVersion, directs]
  );
  const favoriteDirectSet = useMemo(() => new Set(favoriteDirectIds), [favoriteDirectIds]);

  const filteredDirects = useMemo(() => {
    if (section === 'inbox') {
      return directs.filter((roomId) => !favoriteDirectSet.has(roomId));
    }

    if (section === 'unread') {
      return directs.filter((roomId) => roomToUnread.has(roomId));
    }

    return directs.filter((roomId) => {
      const room = mx.getRoom(roomId);
      if (!room) return false;

      if (section === 'favorites') {
        return hasRoomTag(room, FavoriteRoomTag);
      }

      return hasRoomTag(room, LowPriorityRoomTag);
    });
  }, [favoriteDirectSet, mx, directs, roomTagVersion, roomToUnread, section]);

  const noRoomToDisplay = filteredDirects.length === 0;

  const sortedDirects = useMemo(() => {
    const items = Array.from(filteredDirects).sort(factoryRoomIdByActivity(mx));
    return items;
  }, [mx, filteredDirects]);

  const virtualizer = useVirtualizer({
    count: sortedDirects.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 82,
    overscan: 10,
  });

  return (
    <PageNav>
      <DirectHeader />
      <PageNavContent scrollRef={scrollRef}>
        <Box direction="Column" gap="200">
          <DirectFavoritesGrid roomIds={favoriteDirectIds} />
          <DirectSectionFilters section={section} onSectionChange={setSection} />
          {noRoomToDisplay ? (
            <DirectEmpty />
          ) : (
            <>
              <NavCategory>
                <NavItem variant="Background" radii="400" aria-selected={createDirectSelected}>
                  <NavButton onClick={() => navigate(getDirectCreatePath())}>
                    <NavItemContent>
                      <Box as="span" grow="Yes" alignItems="Center" gap="200">
                        <Avatar size="200" radii="400">
                          <Icon src={Icons.Plus} size="100" />
                        </Avatar>
                        <Box as="span" grow="Yes">
                          <Text as="span" size="Inherit" truncate>
                            Create Chat
                          </Text>
                        </Box>
                      </Box>
                    </NavItemContent>
                  </NavButton>
                </NavItem>
              </NavCategory>
              <NavCategory>
                <NavCategoryHeader>
                  <Text size="L400" priority="300">
                    Chats
                  </Text>
                </NavCategoryHeader>
                <div
                  style={{
                    position: 'relative',
                    height: virtualizer.getTotalSize(),
                  }}
                >
                  {virtualizer.getVirtualItems().map((vItem) => {
                    const roomId = sortedDirects[vItem.index];
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
                          direct
                          linkPath={getDirectRoomPath(getCanonicalAliasOrRoomId(mx, roomId))}
                          notificationMode={getRoomNotificationMode(
                            notificationPreferences,
                            room.roomId
                          )}
                        />
                      </VirtualTile>
                    );
                  })}
                </div>
              </NavCategory>
            </>
          )}
        </Box>
      </PageNavContent>
    </PageNav>
  );
}
