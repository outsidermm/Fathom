/**
 * Mirrors docs/api-contract.md and apps/api/app/schemas.py.
 * Keep all three in sync when the contract changes.
 */

export type Model = "gemma-2b" | "qwen2.5-7b";
export type Signature = "hedging" | "refusal" | "unsupported";
export type StreamState = "idle" | "streaming" | "done" | "error";

// ---- client -> server -------------------------------------------------

export type ClientMessage =
  | { type: "start"; prompt: string; model: Model }
  | { type: "clamp"; feature_id: string; value: number } // -1..1
  | { type: "reset_clamps" }
  | { type: "stop" };

// ---- server -> client -------------------------------------------------

export interface Coords {
  x: number;
  y: number;
  z: number;
}

export type ServerMessage =
  | { type: "token"; index: number; text: string; position: number }
  | {
      type: "activation";
      token_index: number;
      feature_id: string;
      value: number; // 0..1
      coords: Coords;
      explanation?: string;
    }
  | {
      type: "flag";
      token_index: number;
      signature: Signature;
      confidence: number;
    }
  | { type: "status"; state: StreamState; message?: string };

// ---- REST ---------------------------------------------------------------

export interface Feature {
  id: string;
  label: string;
  cluster: string;
  description: string;
}

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/stream";
