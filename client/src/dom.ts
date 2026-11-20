export function element<T extends Element>(
  selector: string,
  Constructor: new (...args: never[]) => T,
  parent: ParentNode = document,
): T {
  const found = parent.querySelector(selector);
  if (!(found instanceof Constructor))
    throw new Error(`Missing element: ${selector}`);
  return found;
}
