import { BoxRenderable, type KeyEvent } from "@opentui/core";
import type { App } from "./app.ts";
import { C } from "./theme.ts";

export interface Screen {
  readonly root: BoxRenderable;
  /** Called after the root has been attached to the tree. */
  mount(): void;
  /** Called when the screen is replaced. Must free resources. */
  unmount(): void;
  /** Global key routing (fires for every keypress not consumed by a focused component). */
  onKey?(key: KeyEvent): void;
  /** Called when the user presses Ctrl+C while App.busy is true. */
  onCtrlC?(): void;
}

export abstract class BaseScreen implements Screen {
  abstract readonly root: BoxRenderable;

  constructor(protected app: App) {}

  mount(): void {}
  unmount(): void {
    try {
      this.root.destroyRecursively();
    } catch {
      /* ignore */
    }
  }
  onKey(_key: KeyEvent): void {}
  onCtrlC(): void {
    this.app.quit();
  }

  get renderer() {
    return this.app.renderer;
  }
}

export const DIM = C.dim;
export const TEXT = C.text;
