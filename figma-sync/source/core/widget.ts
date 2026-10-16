import type { FigmaRectangle, WidgetSpec } from '../types';

export function constraintsToWidget(
  constraints: { horizontal?: string; vertical?: string } | undefined,
  bounds: FigmaRectangle,
  parent: FigmaRectangle | undefined,
): WidgetSpec | undefined {
  if (!constraints || !parent) {
    return undefined;
  }
  const left = bounds.x - parent.x;
  const right = parent.x + parent.width - (bounds.x + bounds.width);
  const top = bounds.y - parent.y;
  const bottom = parent.y + parent.height - (bounds.y + bounds.height);
  const horizontalCenter = left + bounds.width / 2 - parent.width / 2;
  const verticalCenter = parent.height / 2 - (top + bounds.height / 2);
  const result: WidgetSpec = {};

  switch (constraints.horizontal) {
    case 'LEFT': Object.assign(result, { alignLeft: true, left, absoluteLeft: true }); break;
    case 'RIGHT': Object.assign(result, { alignRight: true, right, absoluteRight: true }); break;
    case 'LEFT_RIGHT': Object.assign(result, { alignLeft: true, alignRight: true, left, right, absoluteLeft: true, absoluteRight: true }); break;
    case 'CENTER': Object.assign(result, { alignHorizontalCenter: true, horizontalCenter, absoluteHorizontalCenter: true }); break;
    case 'SCALE': Object.assign(result, {
      alignLeft: true,
      alignRight: true,
      left: parent.width ? left / parent.width : 0,
      right: parent.width ? right / parent.width : 0,
      absoluteLeft: false,
      absoluteRight: false,
    }); break;
  }

  switch (constraints.vertical) {
    case 'TOP': Object.assign(result, { alignTop: true, top, absoluteTop: true }); break;
    case 'BOTTOM': Object.assign(result, { alignBottom: true, bottom, absoluteBottom: true }); break;
    case 'TOP_BOTTOM': Object.assign(result, { alignTop: true, alignBottom: true, top, bottom, absoluteTop: true, absoluteBottom: true }); break;
    case 'CENTER': Object.assign(result, { alignVerticalCenter: true, verticalCenter, absoluteVerticalCenter: true }); break;
    case 'SCALE': Object.assign(result, {
      alignTop: true,
      alignBottom: true,
      top: parent.height ? top / parent.height : 0,
      bottom: parent.height ? bottom / parent.height : 0,
      absoluteTop: false,
      absoluteBottom: false,
    }); break;
  }
  return Object.keys(result).length ? result : undefined;
}
