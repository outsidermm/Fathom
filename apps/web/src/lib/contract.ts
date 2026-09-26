/**
 * Mirrors docs/api-contract.md and apps/api/app/schemas.py.
 * Keep all three in sync when the contract changes.
 */

export type Model = "qwen2.5-7b";
export const MODEL_LABELS: Record<Model, string> = { "qwen2.5-7b": "Qwen 2.5 7B" };
export type Signature = "hedging" | "refusal" | "unsupported";
export type StreamState = "idle" | "streaming" | "inspecting" | "done" | "error";

// ---- client -> server -------------------------------------------------

// Where a steer goes: one of the reading's alternatives, a typed direction,
// or away from the reading.
export type SteerDirection =
  | { alternative_id: number }
  | { text: string }
  | { away: true };

export type ClientMessage =
  // pace (default true): hold text at each checkpoint until its AV reading arrives.
  // run_id is echoed on every event of the run.
  | { type: "start"; prompt: string; model: Model; pace?: boolean; run_id?: string }
  | { type: "stop" }
  // Branch run_id at one of its readings (steer_ack, then branch).
  | ({ type: "steer"; run_id: string; checkpoint_id: number } & SteerDirection);

// AR measurement of the state at a steered section's opening: centered cosine
// with the reading's note (current) and the target's note (target).
export interface SteerScore {
  current: number;
  target?: number;
}

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

// Every event of a run carries its run_id.
export type ServerMessage = { run_id?: string } & (
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
      type: "steer_ack"; // under the parent's run_id
      checkpoint_id: number;
      alternative_id?: number;
      applied: boolean; // false: message says why; nothing else changes
      message?: string;
      note?: string; // a typed direction as Qwen understood it
    }
  | {
      type: "branch"; // a steered run starts; its events carry run_id
      run_id: string;
      parent_run_id: string;
      checkpoint_id: number; // the parent's checkpoint it branches at
      position: number; // its text continues the parent's up to here
      kind: "toward" | "away";
      focus: string; // where it steers toward, or the reading it leaves
      opening?: string; // toward: the section opening the steer was made from
      anchored: boolean; // the branch's text starts with opening
    }
  | {
      type: "steer_score"; // AR measurement, after the branch's status:done
      before: SteerScore;
      after: SteerScore;
    }
  | {
      type: "status";
      state: StreamState;
      message?: string;
      checkpoint_id?: number; // with "inspecting"
      label?: string; // with "inspecting"
      av_dropped?: number; // with "done"
    }
);

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
