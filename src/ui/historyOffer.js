// What Zpět and Znovu are offered as of the history (core/history.js): Zpět while
// there is something to take back, Znovu while there is something to put back
// (right after an undo, until a new change clears it). Never in photo mode,
// whose controls belong to the camera. Kept apart from the menu so it can be tested.

export function historyOffer(history, toolId) {
  if (toolId === 'photo') return { undo: false, redo: false };
  return { undo: history.canUndo, redo: history.canRedo };
}
