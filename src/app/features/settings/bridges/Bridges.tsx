import React, { useCallback, useMemo } from 'react';
import {
  Badge,
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Scroll,
  Spinner,
  Text,
} from 'folds';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallbackValue } from '../../../hooks/useAsyncCallback';
import { SequenceCardStyle } from '../styles.css';

type BridgeDescriptor = {
  id: string;
  title: string;
};

const BRIDGES: BridgeDescriptor[] = [
  { id: 'whatsapp', title: 'WhatsApp' },
  { id: 'meta', title: 'Meta' },
  { id: 'discord', title: 'Discord' },
  { id: 'twitter', title: 'Twitter' },
  { id: 'gmessages', title: 'Google Messages' },
  { id: 'googlechat', title: 'Google Chat' },
];

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return 'Failed to fetch bridge discovery data.';
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const getBridgeUrlFromValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  const valueObj = asRecord(value);
  const url = valueObj?.url;
  return typeof url === 'string' ? url : undefined;
};

const normalizeBridgeId = (bridgeId: string): string => bridgeId.toLowerCase().replace(/[\s_-]/g, '');

const findBridgeUrl = (bridges: Record<string, unknown>, bridgeId: string): string | undefined => {
  const wantedId = normalizeBridgeId(bridgeId);
  const foundEntry = Object.entries(bridges).find(([key]) => normalizeBridgeId(key) === wantedId);
  if (!foundEntry) return undefined;
  return getBridgeUrlFromValue(foundEntry[1]);
};

const parseBridgeDiscovery = (data: unknown): Record<string, unknown> => {
  const dataObj = asRecord(data);
  if (!dataObj) return {};

  const candidate = dataObj.bridges ?? dataObj['fi.mau.bridge'] ?? dataObj['com.beeper.bridge'];
  return asRecord(candidate) ?? {};
};

type BridgeDiscoveryData = {
  endpoint: string;
  homeserver: string;
  bridges: Record<string, unknown>;
};

type BridgesProps = {
  requestClose: () => void;
};

export function Bridges({ requestClose }: BridgesProps) {
  const mx = useMatrixClient();
  const homeserver = mx.getHomeserverUrl();

  const endpoint = useMemo(() => {
    try {
      const origin = new URL(homeserver).origin;
      return `${origin}/.well-known/matrix/mautrix`;
    } catch {
      return `${homeserver.replace(/\/+$/, '')}/.well-known/matrix/mautrix`;
    }
  }, [homeserver]);

  const [state, refresh] = useAsyncCallbackValue<BridgeDiscoveryData, Error>(
    useCallback(async () => {
      const response = await fetch(endpoint, { method: 'GET' });
      if (!response.ok) {
        throw new Error(`Bridge discovery unavailable (${response.status}).`);
      }

      const content = (await response.json()) as unknown;
      return {
        endpoint,
        homeserver,
        bridges: parseBridgeDiscovery(content),
      };
    }, [endpoint, homeserver])
  );

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              Bridges
            </Text>
          </Box>
          <Box shrink="No">
            <IconButton onClick={requestClose} variant="Surface">
              <Icon src={Icons.Cross} />
            </IconButton>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <Box direction="Column" gap="700">
              <Box direction="Column" gap="100">
                <Text size="L400">Bridge Discovery</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                  gap="400"
                >
                  <SettingTile
                    title="Homeserver"
                    description={homeserver}
                    after={
                      <Button
                        variant="Secondary"
                        fill="Soft"
                        size="300"
                        radii="300"
                        disabled={state.status === AsyncStatus.Loading}
                        onClick={() => refresh()}
                        before={
                          state.status === AsyncStatus.Loading ? <Spinner size="100" /> : undefined
                        }
                      >
                        <Text size="B300">Refresh</Text>
                      </Button>
                    }
                  />
                  <SettingTile title="Well-known endpoint" description={endpoint} />
                  {state.status === AsyncStatus.Success && (
                    <SettingTile
                      title="Status"
                      description="Discovery online"
                      after={
                        <Badge variant="Success" fill="Soft" radii="Pill" size="400">
                          <Text size="L400">Online</Text>
                        </Badge>
                      }
                    />
                  )}
                  {state.status === AsyncStatus.Error && (
                    <SettingTile
                      title="Status"
                      description={toErrorMessage(state.error)}
                      after={
                        <Badge variant="Critical" fill="Soft" radii="Pill" size="400">
                          <Text size="L400">Offline</Text>
                        </Badge>
                      }
                    />
                  )}
                </SequenceCard>
              </Box>

              <Box direction="Column" gap="100">
                <Text size="L400">Supported Bridges</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                  gap="400"
                >
                  {BRIDGES.map((bridge) => {
                    const bridgeUrl =
                      state.status === AsyncStatus.Success
                        ? findBridgeUrl(state.data.bridges, bridge.id)
                        : undefined;

                    return (
                      <SettingTile
                        key={bridge.id}
                        title={bridge.title}
                        description={bridgeUrl ?? 'Unavailable or not configured'}
                        after={
                          bridgeUrl ? (
                            <Badge variant="Success" fill="Soft" radii="Pill" size="400">
                              <Text size="L400">Available</Text>
                            </Badge>
                          ) : (
                            <Badge variant="Secondary" fill="Soft" radii="Pill" size="400">
                              <Text size="L400">Pending</Text>
                            </Badge>
                          )
                        }
                      />
                    );
                  })}
                </SequenceCard>
              </Box>

              <Box direction="Column" gap="100">
                <Text size="L400">Desktop-only Flows</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                  gap="400"
                >
                  <SettingTile
                    title="Auth UI"
                    description="Some bridge login flows are unsupported on web, use desktop app instead."
                  />
                </SequenceCard>
              </Box>
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
