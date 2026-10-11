// Nothing can be built off the map: the pointer counts as off the map past
// the outermost dots, so no tool snaps to the edge from out on the paper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolManager } from '../src/tools/manager.js';
import { Grid } from '../src/core/grid.js';

test('the pointer is off the map past the outermost dots', () => {
  const grid = new Grid(20, 20);
  const tools = new ToolManager(grid);
  // a tool that snaps by the middle of a big footprint, like a building
  tools.register({ id: 'inspect', snap: (x, y) => grid.nodeAt(x + 1.5, y + 1.5) });
  tools.use('inspect');
  for (const p of [[-0.6, 5], [5, -0.6], [19.6, 5], [5, 19.6], [-3, -3], [25, 10]]) {
    tools.pointer(...p);
    assert.equal(tools.hoverNode, -1, `${p}`);
    assert.equal(tools.point, null);
  }
  tools.pointer(-0.4, 5);
  assert.notEqual(tools.hoverNode, -1, 'the edge dots still take the pointer');
});
