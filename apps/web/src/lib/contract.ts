/**
 * Mirrors docs/api-contract.md and apps/api/app/schemas.py.
 * Keep all three in sync when the contract changes.
 */

// Reserved value shared with the disabled model-select option. The backend
// explicitly rejects it; only qwen2.5-7b can start a generation.
export type Model = "gemma-2b" | "qwen2.5-7b";
export type Signature = "hedging" | "refusal" | "unsupported";
export type StreamState = "idle" | "streaming" | "inspecting" | "done" | "error";

// ---- client -> server -------------------------------------------------

export type ClientMessage =
  // pace (default true): hold text at each checkpoint until its AV reading arrives.
  | { type: "start"; prompt: string; model: Model; pace?: boolean }
  | { type: "clamp"; feature_id: string; value: number } // -1..1
  | { type: "reset_clamps" }
  | { type: "stop" }
  // Pick one of a reading's alternatives. Acknowledged only (steer_ack).
  | { type: "steer"; checkpoint_id: number; alternative_id: number };

// ---- server -> client -------------------------------------------------

// Another step the model could take at a checkpoint, in a reading's form.
// Written by Qwen as a suggestion; not read from the model's state.
export interface AVAlternative {
  id: number; // 0..2
  focus: string;
  detail: string;
}

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
  | {
      type: "av";
      explanation: string;
      layer: 20;
      sample: "replayed_last_content_token" | "prompt_end"; // prompt_end: read before any answer text
      checkpoint_id: number;
      position: number; // Unicode code-point section offset; a timed-out reading can arrive later
      label: string;
      genre: string; // first sentence: mostly the AV's generic prior
      detail: string; // the rest: carries most of the signal
      focus?: string | null; // short "-ing" phrase compressing the detail, from the AV note alone
      replay_ms?: number | null;
      av_ms?: number | null;
    }
  | {
      type: "av_error";
      message: string;
      checkpoint_id: number;
      position: number;
      label: string;
    }
  | {
      type: "av_alternatives"; // after its "av"; may arrive after status:done
      checkpoint_id: number;
      position: number;
      label: string;
      alternatives: AVAlternative[]; // 2..3
    }
  | {
      type: "steer_ack";
      checkpoint_id: number;
      alternative_id: number;
      applied: false; // steering is not connected yet
      message: string;
    }
  | {
      type: "status";
      state: StreamState;
      message?: string;
      checkpoint_id?: number; // with "inspecting"
      label?: string; // with "inspecting"
      av_dropped?: number; // with "done"
    };

// ---- REST ---------------------------------------------------------------

export interface Feature {
  id: string;
  label: string;
  cluster: string;
  description: string;
}

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/stream";
// Enable only for a backend that actually implements clamp/reset messages.
export const STEERING_ENABLED =
  process.env.NEXT_PUBLIC_STEERING_ENABLED === "true";
