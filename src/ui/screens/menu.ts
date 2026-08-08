// Generic modal menu overlay used for actions/confirmations.
import { BoxRenderable, SelectRenderable, SelectRenderableEvents } from "@opentui/core";
import type { App } from "../app.ts";
import { BaseScreen } from "../screen.ts";
import { C } from "../theme.ts";

export interface MenuOption {
  name: string;
  description?: string;
  value?: unknown;
}

export interface MenuProps {
  title: string;
  options: MenuOption[];
  onSelect: (index: number, option: MenuOption) => void;
  onCancel: () => void;
  initialIndex?: number;
}

export class MenuScreen extends BaseScreen {
  readonly root: BoxRenderable;
  private select!: SelectRenderable;

  constructor(app: App, private props: MenuProps) {
    super(app);
    this.root = new BoxRenderable(this.renderer, {
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
    });
  }

  override mount(): void {
    const dim = new BoxRenderable(this.renderer, {
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      backgroundColor: "#000000",
      opacity: 0.55,
    });
    this.root.add(dim);

    const box = new BoxRenderable(this.renderer, {
      width: 52,
      flexDirection: "column",
      borderStyle: "rounded",
      borderColor: C.accent,
      backgroundColor: C.panel,
      title: this.props.title,
      titleColor: C.accent,
      padding: 1,
      gap: 1,
    });

    this.select = new SelectRenderable(this.renderer, {
      width: 48,
      height: this.props.options.length + 2,
      options: this.props.options.map((o) => ({ name: o.name, description: o.description ?? "", value: o.value })),
      selectedIndex: this.props.initialIndex ?? 0,
      selectedBackgroundColor: C.panelAlt,
      selectedTextColor: C.accent,
      textColor: C.text,
      descriptionColor: C.dim,
      selectedDescriptionColor: C.dim,
    });
    this.select.on(SelectRenderableEvents.ITEM_SELECTED, (_idx, option) => {
      const opts = this.props.options;
      const i = opts.findIndex((o) => o.name === option.name);
      this.props.onSelect(i >= 0 ? i : 0, opts[i] ?? opts[0]!);
    });
    box.add(this.select);
    this.root.add(box);
    this.select.focus();
  }

  override onKey(key: import("@opentui/core").KeyEvent): void {
    if (key.name === "escape") this.props.onCancel();
  }
}

export function confirmMenu(app: App, title: string, message: string, onYes: () => void, onNo: () => void): void {
  const screen = new MenuScreen(app, {
    title,
    options: [
      { name: "Yes", value: true },
      { name: "No", value: false },
    ],
    onSelect: (_i, opt) => (opt.value === true ? onYes() : onNo()),
    onCancel: onNo,
  });
  app.setScreen(screen);
}

export function noticeMenu(app: App, title: string, message: string, onOk: () => void): void {
  const screen = new MenuScreen(app, {
    title,
    options: [{ name: "OK", value: true }],
    onSelect: onOk,
    onCancel: onOk,
  });
  app.setScreen(screen);
}
