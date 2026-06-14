import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoomWS, getValidAccessToken } from '../api';
import type { WSEvent } from '../api';

export type RoomWebSocketStatus = 'connecting' | 'connected' | 'disconnected';

type RoomWebSocketHandlers = {
  onMessage?: (event: WSEvent, rawEvent: MessageEvent<string>) => void;
  onOpen?: (socket: WebSocket) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
  onAuthInvalid?: () => void;
  onForbidden?: () => void;
  onMalformedMessage?: (error: unknown) => void;
};

type RoomWebSocketOptions = {
  enabled?: boolean;
  maxReconnectAttempts?: number;
};

const isActiveSocket = (socket: WebSocket | null) =>
  Boolean(socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN));

const isNumericRoomId = (value: string | number | null | undefined) => /^\d+$/.test(String(value ?? ''));

export const useRoomWebSocket = (
  roomId: string | number | null | undefined,
  token: string | null | undefined,
  handlers: RoomWebSocketHandlers = {},
  options: RoomWebSocketOptions = {},
) => {
  const normalizedRoomId = isNumericRoomId(roomId) ? String(roomId) : null;
  const enabled = options.enabled ?? true;
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 5;

  const [status, setStatus] = useState<RoomWebSocketStatus>('disconnected');
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const disposedRef = useRef(false);
  const connectRunRef = useRef(0);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current === null) return;
    window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const closeSocket = useCallback((reason: string) => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (!socket) return;

    if (socket.readyState === WebSocket.OPEN) {
      if (import.meta.env.DEV) {
        console.debug('[room-ws] closing', { roomId: normalizedRoomId, reason });
      }
      socket.close(1000, reason);
      return;
    }

    if (socket.readyState === WebSocket.CONNECTING) {
      if (import.meta.env.DEV) {
        console.debug('[room-ws] close_deferred_until_open', { roomId: normalizedRoomId, reason });
      }
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.onopen = () => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1000, reason);
        }
      };
    }
  }, [normalizedRoomId]);

  const sendJson = useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    connectRunRef.current += 1;
    const runId = connectRunRef.current;

    if (!enabled || !normalizedRoomId) {
      closeSocket('disabled');
      return () => {
        disposedRef.current = true;
        clearReconnectTimer();
        closeSocket('cleanup');
      };
    }

    const scheduleReconnect = () => {
      if (disposedRef.current || reconnectTimerRef.current !== null || isActiveSocket(socketRef.current)) return;
      if (reconnectAttemptRef.current >= maxReconnectAttempts) {
        if (import.meta.env.DEV) {
          console.debug('[room-ws] reconnect_stopped', { roomId: normalizedRoomId });
        }
        return;
      }

      const delay = Math.min(8000, 750 * 2 ** reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (disposedRef.current || runId !== connectRunRef.current) return;
      if (isActiveSocket(socketRef.current)) return;

      setStatus('connecting');
      if (import.meta.env.DEV) {
        console.debug('[room-ws] connecting', { roomId: normalizedRoomId });
      }

      const accessToken = await getValidAccessToken(token);
      if (disposedRef.current || runId !== connectRunRef.current) return;

      if (!accessToken) {
        setStatus('disconnected');
        handlersRef.current.onAuthInvalid?.();
        try {
          window.dispatchEvent(new CustomEvent('cz_auth_invalid'));
        } catch {
          // ignore
        }
        return;
      }

      if (isActiveSocket(socketRef.current)) return;

      const socket = createRoomWS(normalizedRoomId, accessToken);
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposedRef.current || socketRef.current !== socket) {
          if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'stale');
          return;
        }

        reconnectAttemptRef.current = 0;
        setStatus('connected');
        if (import.meta.env.DEV) {
          console.debug('[room-ws] connected', { roomId: normalizedRoomId });
        }
        handlersRef.current.onOpen?.(socket);
      };

      socket.onmessage = (messageEvent: MessageEvent<string>) => {
        if (disposedRef.current || socketRef.current !== socket) return;
        try {
          const parsed = JSON.parse(messageEvent.data) as WSEvent;
          if (import.meta.env.DEV) {
            console.debug('[room-ws] message', {
              roomId: normalizedRoomId,
              event: parsed.event ?? parsed.type,
            });
          }
          handlersRef.current.onMessage?.(parsed, messageEvent);
        } catch (error) {
          handlersRef.current.onMalformedMessage?.(error);
        }
      };

      socket.onerror = (event) => {
        if (disposedRef.current || socketRef.current !== socket) return;
        if (import.meta.env.DEV) {
          console.debug('[room-ws] error', { roomId: normalizedRoomId, readyState: socket.readyState });
        }
        handlersRef.current.onError?.(event);
      };

      socket.onclose = (event) => {
        const isCurrentSocket = socketRef.current === socket;
        if (isCurrentSocket) socketRef.current = null;

        if (import.meta.env.DEV) {
          console.debug('[room-ws] closed', {
            roomId: normalizedRoomId,
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          });
        }

        if (!isCurrentSocket || disposedRef.current || runId !== connectRunRef.current) return;

        handlersRef.current.onClose?.(event);
        setStatus('disconnected');

        if (event.code === 4401) {
          handlersRef.current.onAuthInvalid?.();
          try {
            window.dispatchEvent(new CustomEvent('cz_auth_invalid'));
          } catch {
            // ignore
          }
          return;
        }

        if (event.code === 4403) {
          handlersRef.current.onForbidden?.();
          return;
        }

        if (event.code === 1000 || event.code === 1001 || event.wasClean) return;
        scheduleReconnect();
      };
    };

    void connect();

    return () => {
      disposedRef.current = true;
      clearReconnectTimer();
      closeSocket('cleanup');
      setStatus('disconnected');
    };
  }, [clearReconnectTimer, closeSocket, enabled, maxReconnectAttempts, normalizedRoomId, token]);

  return { status, sendJson };
};
