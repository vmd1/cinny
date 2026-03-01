import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Box, Button, Icon, IconButton, Icons, Scroll, Spinner, Text, config } from 'folds';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallbackValue } from '../../../hooks/useAsyncCallback';
import { SequenceCardStyle } from '../styles.css';
import { getMxIdServer } from '../../../utils/matrix';

type BridgeDescriptor = {
  id: string;
  title: string;
  desktopOnlyPairing?: boolean;
};

const BRIDGES: BridgeDescriptor[] = [
  { id: 'whatsapp', title: 'WhatsApp' },
  { id: 'meta', title: 'Meta', desktopOnlyPairing: true },
  { id: 'discord', title: 'Discord' },
  { id: 'twitter', title: 'Twitter' },
  { id: 'gmessages', title: 'Google Messages' },
  { id: 'googlechat', title: 'Google Chat', desktopOnlyPairing: true },
];

const BRIDGE_LOGIN_LIST_PATHS = [
  '/_matrix/provision/v3/whoami',
  '/v2/login/list',
  '/_matrix/provision/v2/login/list',
  '/_matrix/provision/v1/login/list',
  '/v1/login/list',
];

const BRIDGE_LOGIN_FLOWS_PATHS = ['/_matrix/provision/v3/login/flows', '/v3/login/flows'];

const BRIDGE_LOGIN_START_PATHS = [
  '/_matrix/provision/v3/login/start',
  '/v3/login/start',
  '/v2/login/start',
  '/_matrix/provision/v2/login/start',
  '/_matrix/provision/v1/login/start',
  '/v1/login/start',
];

const BRIDGE_LOGIN_DELETE_REQUESTS: { method: 'DELETE' | 'POST'; path: string }[] = [
  { method: 'POST', path: '/_matrix/provision/v3/logout/{id}' },
  { method: 'POST', path: '/v3/logout/{id}' },
  { method: 'DELETE', path: '/v2/login/{id}' },
  { method: 'DELETE', path: '/_matrix/provision/v2/login/{id}' },
  { method: 'DELETE', path: '/_matrix/provision/v1/login/{id}' },
  { method: 'POST', path: '/v2/login/delete' },
  { method: 'POST', path: '/_matrix/provision/v2/login/delete' },
  { method: 'POST', path: '/_matrix/provision/v1/login/delete' },
];

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return 'Failed to fetch bridge discovery data.';
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const normalizeUrl = (value: string): string => {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value.replace(/^\/+/, '')}`;
};

const MAUTRIX_BRIDGES_KEY = 'fi.mau.bridges';
const MAUTRIX_EXTERNAL_SERVERS_KEY = 'fi.mau.external_bridge_servers';

const getBridgeUrlFromValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return normalizeUrl(value);
  const valueObj = asRecord(value);

  const nestedProvisioning = asRecord(valueObj?.provisioning);
  const nestedBridge = asRecord(valueObj?.bridge);

  const candidates = [
    valueObj?.url,
    valueObj?.bridge_url,
    valueObj?.bridgeUrl,
    valueObj?.provisioning_url,
    valueObj?.provisioningUrl,
    valueObj?.api_url,
    valueObj?.apiUrl,
    valueObj?.base_url,
    valueObj?.baseUrl,
    nestedProvisioning?.url,
    nestedProvisioning?.base_url,
    nestedBridge?.url,
  ];

  const found = candidates.find((entry) => typeof entry === 'string') as string | undefined;
  return found ? normalizeUrl(found) : undefined;
};

const normalizeBridgeId = (bridgeId: string): string => bridgeId.toLowerCase().replace(/[\s_-]/g, '');

const guessBridgeIdFromUrl = (bridgeUrl: string): string => {
  const normalized = bridgeUrl.toLowerCase();
  if (normalized.includes('whatsapp')) return 'whatsapp';
  if (normalized.includes('meta')) return 'meta';
  if (normalized.includes('facebook')) return 'meta';
  if (normalized.includes('discord')) return 'discord';
  if (normalized.includes('twitter')) return 'twitter';
  if (normalized.includes('gmessages') || normalized.includes('google-messages')) return 'gmessages';
  if (normalized.includes('googlechat') || normalized.includes('google-chat')) return 'googlechat';

  try {
    const { pathname } = new URL(bridgeUrl);
    const segments = pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? bridgeUrl;
  } catch {
    return bridgeUrl;
  }
};

const getStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const findBridgeUrl = (bridges: Record<string, unknown>, bridgeId: string): string | undefined => {
  const wantedId = normalizeBridgeId(bridgeId);
  const foundEntry = Object.entries(bridges).find(([key]) => normalizeBridgeId(key) === wantedId);
  if (foundEntry) return getBridgeUrlFromValue(foundEntry[1]);

  const byUrl = Object.values(bridges)
    .map((value) => getBridgeUrlFromValue(value))
    .find((url) => typeof url === 'string' && normalizeBridgeId(url).includes(wantedId));

  return byUrl;
};

const isLikelyBridgeMap = (record: Record<string, unknown>): boolean =>
  Object.values(record).some((value) => Boolean(getBridgeUrlFromValue(value)));

const parseBridgeDiscovery = (data: unknown): Record<string, unknown> => {
  const dataObj = asRecord(data);
  if (!dataObj) return {};

  const bridgeUrlList = getStringArray(dataObj[MAUTRIX_BRIDGES_KEY]);
  if (bridgeUrlList.length > 0) {
    return Object.fromEntries(
      bridgeUrlList.map((url) => {
        const normalizedUrl = normalizeUrl(url);
        return [guessBridgeIdFromUrl(normalizedUrl), { url: normalizedUrl }];
      })
    );
  }

  const namespaceCandidates = [
    dataObj.bridges,
    dataObj['fi.mau.bridge'],
    dataObj['com.beeper.bridge'],
    dataObj['com.beeper.bridges'],
    dataObj['m.bridge'],
  ];

  for (const candidate of namespaceCandidates) {
    const map = asRecord(candidate);
    if (map && isLikelyBridgeMap(map)) return map;
  }

  const bridgeLikeEntries = Object.entries(dataObj).filter(([key, value]) => {
    const map = asRecord(value);
    if (!map) return false;
    return /bridge/i.test(key) && isLikelyBridgeMap(map);
  });

  if (bridgeLikeEntries.length > 0) {
    return asRecord(bridgeLikeEntries[0][1]) ?? {};
  }

  if (isLikelyBridgeMap(dataObj)) return dataObj;

  return {};
};

const mergeBridgeMaps = (
  base: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> => ({
  ...base,
  ...incoming,
});

const fetchWellKnownPayload = async (endpoint: string): Promise<unknown | undefined> => {
  try {
    const response = await fetch(endpoint, { method: 'GET' });
    if (!response.ok) return undefined;
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
};

type BridgeDiscoveryData = {
  endpoint: string;
  homeserver: string;
  bridges: Record<string, unknown>;
};

type BridgeConnection = {
  id: string;
  title: string;
  status: string;
  setup: string;
  raw: unknown;
};

type BridgeLoginFlow = {
  id: string;
  name?: string;
  description?: string;
};

type PairingResult = {
  url?: string;
  qr?: string;
  code?: string;
};

const isDesktopRuntime = (): boolean =>
  /(Electron|Tauri|CinnyDesktop)/i.test(window.navigator.userAgent);

const getJsonIfAny = async (response: Response): Promise<unknown | undefined> => {
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) return undefined;

  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const getConnectionId = (entry: Record<string, unknown>, index: number): string => {
  const candidates = [
    entry.id,
    entry.login_id,
    entry.loginId,
    entry.account_id,
    entry.accountId,
    entry.remote_id,
    entry.remoteId,
    entry.user_id,
    entry.userId,
    entry.mxid,
    entry.jid,
    entry.phone,
  ];

  const found = candidates.find((value) => typeof value === 'string') as string | undefined;
  return found ?? `connection-${index + 1}`;
};

const parseConnectionList = (payload: unknown): BridgeConnection[] => {
  if (Array.isArray(payload)) {
    return payload.map((item, index) => {
      const entry = asRecord(item) ?? {};
      const id = getConnectionId(entry, index);
      const title =
        (entry.name as string | undefined) ??
        (entry.display_name as string | undefined) ??
        (entry.remote_name as string | undefined) ??
        (entry.phone as string | undefined) ??
        id;
      const status =
        (entry.status as string | undefined) ??
        (entry.state as string | undefined) ??
        ((entry.connected as boolean | undefined) === true ? 'Connected' : 'Unknown');

      return {
        id,
        title,
        status,
        setup: JSON.stringify(entry, null, 2),
        raw: entry,
      };
    });
  }

  const obj = asRecord(payload);
  if (!obj) return [];

  const listCandidates = [obj.connections, obj.logins, obj.accounts, obj.items, obj.data];
  for (const candidate of listCandidates) {
    if (Array.isArray(candidate)) return parseConnectionList(candidate);
  }

  return [];
};

const parseConnectionsFromWhoami = (payload: unknown): BridgeConnection[] => {
  const obj = asRecord(payload);
  const logins = Array.isArray(obj?.logins) ? obj?.logins : [];

  return logins.map((item, index) => {
    const entry = asRecord(item) ?? {};
    const state = asRecord(entry.state);
    const profile = asRecord(entry.profile);
    const id =
      (entry.id as string | undefined) ??
      (entry.login_id as string | undefined) ??
      (entry.loginId as string | undefined) ??
      `connection-${index + 1}`;
    const title =
      (entry.name as string | undefined) ??
      (profile?.name as string | undefined) ??
      (profile?.username as string | undefined) ??
      id;
    const status =
      (state?.state_event as string | undefined) ??
      (state?.message as string | undefined) ??
      'Unknown';

    return {
      id,
      title,
      status,
      setup: JSON.stringify(entry, null, 2),
      raw: entry,
    };
  });
};

const parseLoginFlows = (payload: unknown): BridgeLoginFlow[] => {
  const obj = asRecord(payload);
  const flows = Array.isArray(obj?.flows) ? obj.flows : [];

  return flows
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item.id === 'string'))
    .map((item) => ({
      id: item.id as string,
      name: item.name as string | undefined,
      description: item.description as string | undefined,
    }));
};

const buildDiscoveryEndpoints = (homeserver: string, userId: string): string[] => {
  const endpoints: string[] = [];
  const mxidServer = getMxIdServer(userId);
  if (mxidServer) endpoints.push(`https://${mxidServer}/.well-known/matrix/mautrix`);

  try {
    const parsed = new URL(homeserver);
    endpoints.push(`https://${parsed.hostname}/.well-known/matrix/mautrix`);
    endpoints.push(`${parsed.origin}/.well-known/matrix/mautrix`);
  } catch {
    const host = homeserver.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (host) endpoints.push(`https://${host}/.well-known/matrix/mautrix`);
  }

  return Array.from(new Set(endpoints));
};

const discoverBridges = async (
  homeserver: string,
  userId: string
): Promise<{ endpoint: string; bridges: Record<string, unknown> }> => {
  const candidates = buildDiscoveryEndpoints(homeserver, userId);
  let lastError: unknown;

  for (const endpoint of candidates) {
    try {
      const payload = await fetchWellKnownPayload(endpoint);
      if (!payload) {
        lastError = new Error(`Bridge discovery unavailable at ${endpoint}.`);
        continue;
      }

      const payloadObj = asRecord(payload);
      let bridges = parseBridgeDiscovery(payload);

      const externalServers = getStringArray(payloadObj?.[MAUTRIX_EXTERNAL_SERVERS_KEY]);
      for (const server of externalServers) {
        const externalPayload = await fetchWellKnownPayload(
          `https://${server}/.well-known/matrix/mautrix`
        );
        if (!externalPayload) continue;
        bridges = mergeBridgeMaps(bridges, parseBridgeDiscovery(externalPayload));
      }

      if (Object.keys(bridges).length === 0) {
        lastError = new Error(`No bridges in .well-known payload at ${endpoint}.`);
        continue;
      }
      return { endpoint, bridges };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('Unable to discover bridges from well-known endpoints.');
};

const getPairingUrlFromResult = (result: unknown): string | undefined => {
  const data = asRecord(result);
  if (!data) return undefined;

  const candidates = [data.url, data.login_url, data.loginUrl, data.pair_url, data.pairUrl];
  return candidates.find((entry) => typeof entry === 'string') as string | undefined;
};

const getPairingCodeFromResult = (result: unknown): string | undefined => {
  const data = asRecord(result);
  if (!data) return undefined;

  const candidates = [data.code, data.pairing_code, data.pairingCode];
  return candidates.find((entry) => typeof entry === 'string') as string | undefined;
};

const getPairingQrFromResult = (result: unknown): string | undefined => {
  const data = asRecord(result);
  if (!data) return undefined;

  const candidates = [data.qr, data.qr_data, data.qrData, data.qr_code, data.qrCode];
  return candidates.find((entry) => typeof entry === 'string') as string | undefined;
};

const startPairing = async (
  bridgeUrl: string,
  bridgeId: string,
  userId: string,
  accessToken: string | null,
  homeserver: string
): Promise<PairingResult> => {
  const base = bridgeUrl.replace(/\/+$/, '');

  for (const flowPath of BRIDGE_LOGIN_FLOWS_PATHS) {
    const flowsEndpoint = `${base}${flowPath}`;
    try {
      const flowResponse = await fetch(`${flowsEndpoint}?user_id=${encodeURIComponent(userId)}`, {
        method: 'GET',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });

      if (!flowResponse.ok) continue;

      const flowsPayload = (await getJsonIfAny(flowResponse)) ?? {};
      const flows = parseLoginFlows(flowsPayload);
      if (flows.length === 0) continue;

      const selectedFlow = flows[0];
      const managerLikeStart = `${base}/_matrix/provision/v3/login/start/${encodeURIComponent(
        selectedFlow.id
      )}?user_id=${encodeURIComponent(userId)}`;

      const managerResponse = await fetch(managerLikeStart, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({}),
      });

      if (managerResponse.ok) {
        const result = (await managerResponse.json()) as unknown;
        return {
          url: getPairingUrlFromResult(result),
          qr: getPairingQrFromResult(result),
          code: getPairingCodeFromResult(result),
        };
      }
    } catch {
      continue;
    }
  }

  const payload = {
    bridge_id: bridgeId,
    user_id: userId,
    homeserver,
    access_token: accessToken,
  };

  for (const path of BRIDGE_LOGIN_START_PATHS) {
    const endpoint = `${base}${path}`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) continue;

      const result = (await response.json()) as unknown;
      return {
        url: getPairingUrlFromResult(result),
        qr: getPairingQrFromResult(result),
        code: getPairingCodeFromResult(result),
      };
    } catch {
      continue;
    }
  }

  throw new Error('Pairing endpoint unavailable on this bridge.');
};

const listBridgeConnections = async (
  bridgeUrl: string,
  userId: string,
  accessToken: string | null
): Promise<BridgeConnection[]> => {
  const base = bridgeUrl.replace(/\/+$/, '');

  for (const whoamiPath of ['/_matrix/provision/v3/whoami', '/v3/whoami']) {
    const endpoint = `${base}${whoamiPath}?user_id=${encodeURIComponent(userId)}`;
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });
      if (!response.ok) continue;

      const payload = (await getJsonIfAny(response)) ?? {};
      return parseConnectionsFromWhoami(payload);
    } catch {
      continue;
    }
  }

  for (const path of BRIDGE_LOGIN_LIST_PATHS) {
    const endpoint = `${base}${path}`;
    const withUserEndpoint = `${endpoint}?user_id=${encodeURIComponent(userId)}`;

    for (const candidateEndpoint of [withUserEndpoint, endpoint]) {
      try {
        const response = await fetch(candidateEndpoint, {
          method: 'GET',
          headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
        });
        if (!response.ok) continue;

        const payload = (await getJsonIfAny(response)) ?? [];
        return parseConnectionList(payload);
      } catch {
        continue;
      }
    }
  }

  throw new Error('Unable to fetch bridge connections.');
};

const deleteBridgeConnection = async (
  bridgeUrl: string,
  userId: string,
  accessToken: string | null,
  connectionId: string
): Promise<void> => {
  const base = bridgeUrl.replace(/\/+$/, '');

  for (const request of BRIDGE_LOGIN_DELETE_REQUESTS) {
    const endpoint = `${base}${request.path.replace('{id}', encodeURIComponent(connectionId))}`;

    try {
      const response = await fetch(endpoint, {
        method: request.method,
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body:
          request.method === 'POST'
            ? JSON.stringify({
                login_id: connectionId,
                account_id: connectionId,
                user_id: userId,
              })
            : undefined,
      });

      if (response.ok) return;
    } catch {
      continue;
    }
  }

  throw new Error('Failed to delete bridge connection.');
};

type BridgesProps = {
  requestClose: () => void;
};

export function Bridges({ requestClose }: BridgesProps) {
  const mx = useMatrixClient();
  const homeserver = mx.getHomeserverUrl();
  const userId = mx.getUserId() ?? '';
  const desktopRuntime = isDesktopRuntime();
  const accessToken = mx.getAccessToken() ?? null;

  const [pairingStateByBridge, setPairingStateByBridge] = useState<
    Record<string, { status: 'idle' | 'loading' | 'success' | 'error'; message?: string }>
  >({});
  const [connectionsByBridge, setConnectionsByBridge] = useState<Record<string, BridgeConnection[]>>({});
  const [connectionsLoadingByBridge, setConnectionsLoadingByBridge] = useState<Record<string, boolean>>({});
  const [connectionsMessageByBridge, setConnectionsMessageByBridge] = useState<
    Record<string, string | undefined>
  >({});
  const [expandedSetupMap, setExpandedSetupMap] = useState<Record<string, boolean>>({});

  const endpointCandidates = useMemo(() => buildDiscoveryEndpoints(homeserver, userId), [homeserver, userId]);

  const [state, refresh] = useAsyncCallbackValue<BridgeDiscoveryData, Error>(
    useCallback(async () => {
      const discovered = await discoverBridges(homeserver, userId);
      return {
        endpoint: discovered.endpoint,
        homeserver,
        bridges: discovered.bridges,
      };
    }, [homeserver, userId])
  );

  const refreshBridgeConnections = useCallback(
    async (bridgeId: string, bridgeUrl: string) => {
      setConnectionsLoadingByBridge((prev) => ({ ...prev, [bridgeId]: true }));
      setConnectionsMessageByBridge((prev) => ({ ...prev, [bridgeId]: undefined }));

      try {
        const list = await listBridgeConnections(bridgeUrl, userId, accessToken);
        setConnectionsByBridge((prev) => ({ ...prev, [bridgeId]: list }));
      } catch (error) {
        setConnectionsByBridge((prev) => ({ ...prev, [bridgeId]: [] }));
        setConnectionsMessageByBridge((prev) => ({ ...prev, [bridgeId]: toErrorMessage(error) }));
      } finally {
        setConnectionsLoadingByBridge((prev) => ({ ...prev, [bridgeId]: false }));
      }
    },
    [accessToken, userId]
  );

  useEffect(() => {
    if (state.status !== AsyncStatus.Success) return;

    BRIDGES.forEach((bridge) => {
      const bridgeUrl = findBridgeUrl(state.data.bridges, bridge.id);
      if (!bridgeUrl) return;
      refreshBridgeConnections(bridge.id, bridgeUrl);
    });
  }, [refreshBridgeConnections, state]);

  const handleStartPairing = useCallback(
    async (bridgeId: string, bridgeTitle: string, bridgeUrl: string) => {
      setPairingStateByBridge((prev) => ({
        ...prev,
        [bridgeId]: { status: 'loading', message: 'Starting pairing…' },
      }));

      try {
        const result = await startPairing(
          bridgeUrl,
          bridgeId,
          userId,
          accessToken,
          homeserver
        );

        if (result.url) {
          window.open(result.url, '_blank', 'noopener,noreferrer');
          setPairingStateByBridge((prev) => ({
            ...prev,
            [bridgeId]: { status: 'success', message: `${bridgeTitle} pairing started.` },
          }));
          return;
        }

        if (result.code || result.qr) {
          const detail = result.code ? `Code: ${result.code}` : 'QR pairing received.';
          setPairingStateByBridge((prev) => ({
            ...prev,
            [bridgeId]: { status: 'success', message: detail },
          }));
          return;
        }

        setPairingStateByBridge((prev) => ({
          ...prev,
          [bridgeId]: { status: 'success', message: `${bridgeTitle} pairing requested.` },
        }));

        await refreshBridgeConnections(bridgeId, bridgeUrl);
      } catch (error) {
        setPairingStateByBridge((prev) => ({
          ...prev,
          [bridgeId]: {
            status: 'error',
            message: toErrorMessage(error),
          },
        }));
      }
    },
    [accessToken, homeserver, refreshBridgeConnections, userId]
  );

  const handleDeleteConnection = useCallback(
    async (bridgeId: string, bridgeUrl: string, connectionId: string) => {
      setConnectionsMessageByBridge((prev) => ({ ...prev, [bridgeId]: undefined }));

      try {
        await deleteBridgeConnection(bridgeUrl, userId, accessToken, connectionId);
        await refreshBridgeConnections(bridgeId, bridgeUrl);
      } catch (error) {
        setConnectionsMessageByBridge((prev) => ({ ...prev, [bridgeId]: toErrorMessage(error) }));
      }
    },
    [accessToken, refreshBridgeConnections, userId]
  );

  const toggleSetup = (bridgeId: string, connectionId: string) => {
    const key = `${bridgeId}:${connectionId}`;
    setExpandedSetupMap((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
                  <SettingTile
                    title="Discovery endpoints"
                    description={
                      state.status === AsyncStatus.Success
                        ? state.data.endpoint
                        : endpointCandidates.join('\n')
                    }
                  />
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

                    const pairingState = pairingStateByBridge[bridge.id];
                    const desktopOnlyLocked = Boolean(bridge.desktopOnlyPairing && !desktopRuntime);
                    const bridgeConnections = connectionsByBridge[bridge.id] ?? [];
                    const bridgeConnectionsLoading = connectionsLoadingByBridge[bridge.id];
                    const bridgeConnectionsMessage = connectionsMessageByBridge[bridge.id];

                    return (
                      <Box key={bridge.id} direction="Column" gap="200">
                        <SettingTile
                          title={bridge.title}
                          description={
                            pairingState?.message ??
                            bridgeConnectionsMessage ??
                            (desktopOnlyLocked
                              ? 'Unsupported on web, use desktop app instead.'
                              : bridgeUrl ?? 'Unavailable or not configured')
                          }
                          after={
                            bridgeUrl ? (
                              <Box alignItems="Center" gap="100">
                                <Badge variant="Success" fill="Soft" radii="Pill" size="400">
                                  <Text size="L400">Available</Text>
                                </Badge>
                                <Button
                                  variant={desktopOnlyLocked ? 'Secondary' : 'Primary'}
                                  fill={desktopOnlyLocked ? 'Soft' : 'Solid'}
                                  size="300"
                                  radii="300"
                                  disabled={desktopOnlyLocked || pairingState?.status === 'loading'}
                                  onClick={() => handleStartPairing(bridge.id, bridge.title, bridgeUrl)}
                                  before={
                                    pairingState?.status === 'loading' ? (
                                      <Spinner size="100" variant="Primary" fill="Solid" />
                                    ) : undefined
                                  }
                                >
                                  <Text size="B300">{desktopOnlyLocked ? 'Desktop Only' : 'Pair'}</Text>
                                </Button>
                                <Button
                                  variant="Secondary"
                                  fill="Soft"
                                  size="300"
                                  radii="300"
                                  disabled={bridgeConnectionsLoading}
                                  onClick={() => refreshBridgeConnections(bridge.id, bridgeUrl)}
                                >
                                  <Text size="B300">Refresh</Text>
                                </Button>
                              </Box>
                            ) : (
                              <Badge variant="Secondary" fill="Soft" radii="Pill" size="400">
                                <Text size="L400">Pending</Text>
                              </Badge>
                            )
                          }
                        />

                        {bridgeUrl && (
                          <Box direction="Column" gap="100" style={{ paddingLeft: config.space.S100 }}>
                            {bridgeConnectionsLoading ? (
                              <Box alignItems="Center" gap="100">
                                <Spinner size="100" />
                                <Text size="T200" priority="300">
                                  Loading connections…
                                </Text>
                              </Box>
                            ) : bridgeConnections.length === 0 ? (
                              <Text size="T200" priority="300">
                                No active connections.
                              </Text>
                            ) : (
                              bridgeConnections.map((connection) => {
                                const expanded = expandedSetupMap[`${bridge.id}:${connection.id}`];

                                return (
                                  <Box
                                    key={`${bridge.id}:${connection.id}`}
                                    direction="Column"
                                    gap="100"
                                    style={{
                                      padding: config.space.S200,
                                      borderRadius: config.radii.R300,
                                      background: 'rgba(255 255 255 / 0.02)',
                                    }}
                                  >
                                    <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
                                      <Box direction="Column" gap="0" grow="Yes">
                                        <Text size="T300" truncate>
                                          {connection.title}
                                        </Text>
                                        <Text size="T200" priority="300" truncate>
                                          {connection.status}
                                        </Text>
                                      </Box>
                                      <Box alignItems="Center" gap="100" shrink="No">
                                        <Button
                                          variant="Secondary"
                                          fill="Soft"
                                          size="300"
                                          radii="300"
                                          onClick={() => toggleSetup(bridge.id, connection.id)}
                                        >
                                          <Text size="B300">{expanded ? 'Hide Setup' : 'View Setup'}</Text>
                                        </Button>
                                        <Button
                                          variant="Critical"
                                          fill="Soft"
                                          size="300"
                                          radii="300"
                                          onClick={() =>
                                            handleDeleteConnection(bridge.id, bridgeUrl, connection.id)
                                          }
                                        >
                                          <Text size="B300">Delete</Text>
                                        </Button>
                                      </Box>
                                    </Box>
                                    {expanded && (
                                      <Box
                                        as="pre"
                                        style={{
                                          margin: 0,
                                          padding: config.space.S200,
                                          borderRadius: config.radii.R300,
                                          background: 'rgba(0 0 0 / 0.35)',
                                          whiteSpace: 'pre-wrap',
                                          overflowWrap: 'anywhere',
                                          fontSize: 12,
                                          lineHeight: '16px',
                                        }}
                                      >
                                        {connection.setup}
                                      </Box>
                                    )}
                                  </Box>
                                );
                              })
                            )}
                          </Box>
                        )}
                      </Box>
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
