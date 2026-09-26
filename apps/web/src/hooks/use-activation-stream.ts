"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ClientMessage,
  Coords,
  Model,
  ServerMessage,
  Signature,
  StreamState,
} from "@/lib/contract";
import { WS_URL } from "@/lib/contract";

export interface TokenEntry {
  index: number;
  text: string;
}

export interface ActivationEntry {
  tokenIndex: number;
  featureId: string;
  value: number;
  coords: Coords;
}

export interface FlagEntry {
  tokenIndex: number;
  signature: Signature;
  confidence: number;
}

/**
 * Owns the websocket connection described in docs/api-contract.md.
 * Points at the mock API by default (apps/api/app/mock_stream.py) —
 * swap nothing here when the real model pipeline lands, only the
 * server-side implementation behind the same contract.
 */
export function useActivationStream() {
  const [status, setStatus] = useState<StreamState>("idle");
  const [tokens, setTokens] = useState<TokenEntry[]>([]);
  const [activations, setActivations] = useState<ActivationEntry[]>([]);
  const [flags, setFlags] = useState<FlagEntry[]>([]);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      switch (msg.type) {
        case "status":
          setStatus(msg.state);
          break;
        case "token":
          setTokens((prev) => [...prev, { index: msg.index, text: msg.text }]);
          break;
        case "activation":
          setActivations((prev) => [
            ...prev,
            {
              tokenIndex: msg.token_index,
              featureId: msg.feature_id,
              value: msg.value,
              coords: msg.coords,
            },
          ]);
          break;
        case "flag":
          setFlags((prev) => [
            ...prev,
            {
              tokenIndex: msg.token_index,
              signature: msg.signature,
              confidence: msg.confidence,
            },
          ]);
          break;
      }
    };

    return () => ws.close();
  }, []);

  const send = useCallback((message: ClientMessage) => {
    wsRef.current?.send(JSON.stringify(message));
  }, []);

  const start = useCallback(
    (prompt: string, model: Model) => {
      setTokens([]);
      setActivations([]);
      setFlags([]);
      send({ type: "start", prompt, model });
    },
    [send]
  );

  const clamp = useCallback(
    (featureId: string, value: number) => send({ type: "clamp", feature_id: featureId, value }),
    [send]
  );

  const resetClamps = useCallback(() => send({ type: "reset_clamps" }), [send]);
  const stop = useCallback(() => send({ type: "stop" }), [send]);

  return { status, connected, tokens, activations, flags, start, clamp, resetClamps, stop };
}
