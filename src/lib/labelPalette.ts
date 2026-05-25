/**
 * Shared label-color palette — the swatch grid users pick from when
 * creating / recoloring a label in either LabelPicker (inline add
 * flow inside the cell picker) or LabelsEditorModal (full editor).
 *
 * Expanded from the original 8-swatch OKLCH-token set to a full
 * Monday-style Family of named hexes including LIGHT + DARK shades
 * of each hue. Display only — what the user picks is stored as-is
 * (#RRGGBB, hex case-insensitive via colorsEqual).
 *
 * Grouped by hue family so the grid reads as a related set rather
 * than a random rainbow:
 *
 *   green    : #00C875  #4CD297  #037F4C
 *   orange   : #FDAB3D  #FFCB00  #FDBB71  #F68A5C
 *   red/pink : #E2445C  #FF7575  #E16E7F  #C26175  #F64F9F  #FF158A
 *   purple   : #A25DDC  #784BD1  #B280DF  #5559DF
 *   blue     : #579BFC  #66CCFF  #0086C0  #00C0EF  #419DCC  #7BB0F6
 *   grays    : #C4C4C4  #777E91  #808080
 *
 * Reuses the existing colorNormalize pipeline (toCanonicalHex /
 * colorsEqual) — no oklch strings introduced, the selected-swatch
 * highlight stays case-insensitive against the stored value.
 */
export const LABEL_PALETTE: readonly string[] = [
  // greens
  '#00C875', '#4CD297', '#037F4C',
  // oranges / yellows
  '#FDAB3D', '#FFCB00', '#FDBB71', '#F68A5C',
  // reds / pinks
  '#E2445C', '#FF7575', '#E16E7F', '#C26175', '#F64F9F', '#FF158A',
  // purples / indigos
  '#A25DDC', '#784BD1', '#B280DF', '#5559DF',
  // blues
  '#579BFC', '#66CCFF', '#0086C0', '#00C0EF', '#419DCC', '#7BB0F6',
  // grays
  '#C4C4C4', '#777E91', '#808080',
] as const;
