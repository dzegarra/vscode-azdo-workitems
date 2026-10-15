/** Horizontal placement of the popovers inside the view. Pure: no DOM, no "vscode" import */

export type PopoverAlign = 'start' | 'end';

export interface PopoverPlacementInput {
  /** Left and right edges of the element that opens the popover, in viewport pixels */
  anchorLeft: number;
  anchorRight: number;
  /** Width of the view without the vertical scrollbar (document.documentElement.clientWidth, never innerWidth / 100vw) */
  viewWidth: number;
  preferredWidth: number;
  /** Space kept free on both sides of the view */
  margin: number;
  /** 'start': left edges aligned; 'end': right edges aligned */
  align: PopoverAlign;
}

export interface PopoverPlacement {
  width: number;
  /** Left edge of the popover, in viewport pixels */
  left: number;
}

/** The popover is as wide as it wants, up to the view minus the margins, aligned to its anchor and shifted to stay inside */
export function placePopover(input: PopoverPlacementInput): PopoverPlacement {
  const { anchorLeft, anchorRight, viewWidth, preferredWidth, margin, align } = input;
  const width = Math.max(0, Math.min(preferredWidth, viewWidth - 2 * margin));
  const wanted = align === 'end' ? anchorRight - width : anchorLeft;
  const left = Math.max(margin, Math.min(wanted, viewWidth - margin - width));
  return { width, left };
}
