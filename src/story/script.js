// The story script: a plain text file (story/story.txt) of rules and
// branches of dialogue. See story/README.md for how to write one. This file
// only reads the text and works out conditions – nothing here knows about
// the town; the storyteller (storyteller.js) hands in the numbers.
//
//   parseStory(text)          { rules, branches, errors }
//   evaluate(expr, lookup, seen, exists)   the value of a parsed condition;
//                             lookup(name) gives a variable's value,
//                             seen(name) whether a branch has been told,
//                             exists(ref) whether a building stands
//   normalName(name)          how names are compared: lower case, '_' for
//                             any '-', '.' or space, no '_amount' at the end
//
// Rules, one per line, outside branches:
//   if <condition> trigger <Branch>
// Branches:
//   ::Name::            starts one (a line of just '::' ends it)
//   Speaker: text       a line of dialogue
//   text                a line with nobody speaking (narration)
//   > text -> Branch    a choice; choices one after another are offered together
//   -> Branch           go on in another branch
//   if <condition> -> Branch   …only if it holds
//   set name = <expression>    remember a number for later conditions
//   chronicle: text     write a line in the town's chronicle
//   unlock name / lock name    what may be built (see unlocks.js)
//   scheme name         the colour scheme (as in unlocks.txt)
//   pick name = <which> a building, by its house number, remembered as
//                       `name`: a number, or [oldest | newest | random]
//                       <type or tag>, or nearest <type or tag> to <place>
//   send <places> -> <place>   their people go there, stay, come home
//   ignite <place>      it catches fire (and burns down in time)
//   put out <place>     the fire there is put out: it stays
//   burn <place>        it burns down (now, burning or not)
// A <place> is a house number or a name picked; exists(place) in a
// condition is whether it stands (and isn't burnt).
// '#' starts a comment (a whole line). {name} in a text is replaced by the
// variable's value, {town} by the town's name.

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false']);

export function normalName(name) {
  return String(name).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s.\-]+/g, '_').replace(/_(amount|count|number)$/, '');
}

// ---------- conditions ----------

function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_À-ɏ][\w.\-À-ɏ]*)|(>=|<=|==|!=|&&|\|\||[<>=!+\-*/(),]))/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`can't read "${src.slice(i).trim()}"`);
    if (m[1]) out.push({ k: 'num', v: Number(m[1]) });
    else if (m[2]) {
      // a trailing '-' or '.' belongs to what follows (a minus), not the name
      const name = m[2].replace(/[.\-]+$/, '');
      out.push({ k: 'name', v: name });
      i = m.index + m[0].length - (m[2].length - name.length);
      continue;
    } else out.push({ k: 'op', v: m[3] });
    i = re.lastIndex;
  }
  return out;
}

// Precedence climbing: or < and < not < comparison < + - < * / < unary.
export function parseExpression(src) {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (...ops) => peek()?.k === 'op' && ops.includes(peek().v);
  const isWord = (w) => peek()?.k === 'name' && peek().v.toLowerCase() === w;
  const take = () => tokens[i++];

  const or = () => {
    let a = and();
    while (isWord('or') || isOp('||')) { take(); a = { op: 'or', a, b: and() }; }
    return a;
  };
  const and = () => {
    let a = not();
    while (isWord('and') || isOp('&&')) { take(); a = { op: 'and', a, b: not() }; }
    return a;
  };
  const not = () => {
    if (isWord('not') || isOp('!')) { take(); return { op: 'not', a: not() }; }
    return compare();
  };
  const compare = () => {
    let a = sum();
    if (isOp('>', '<', '>=', '<=', '==', '!=', '=')) {
      const op = take().v;
      a = { op: op === '=' ? '==' : op, a, b: sum() };
    }
    return a;
  };
  const sum = () => {
    let a = product();
    while (isOp('+', '-')) { const op = take().v; a = { op, a, b: product() }; }
    return a;
  };
  const product = () => {
    let a = unary();
    while (isOp('*', '/')) { const op = take().v; a = { op, a, b: unary() }; }
    return a;
  };
  const unary = () => {
    if (isOp('-')) { take(); return { op: 'neg', a: unary() }; }
    return primary();
  };
  const primary = () => {
    const t = take();
    if (!t) throw new Error('the condition ends too soon');
    if (t.k === 'num') return { num: t.v };
    if (t.k === 'op' && t.v === '(') {
      const e = or();
      if (!isOp(')')) throw new Error('a ")" is missing');
      take();
      return e;
    }
    if (t.k === 'name') {
      const low = t.v.toLowerCase();
      if (low === 'true') return { num: 1 };
      if (low === 'false') return { num: 0 };
      if (KEYWORDS.has(low)) throw new Error(`"${t.v}" where a value should be`);
      if (isOp('(')) {
        take();
        const arg = take();
        if (low === 'exists') {
          if (!(arg?.k === 'name' || arg?.k === 'num') || !isOp(')')) throw new Error('exists( ) takes a house number or a name picked');
          take();
          return { exists: placeRef(String(arg.v)), name: String(arg.v) };
        }
        if (arg?.k !== 'name' || !isOp(')')) throw new Error(`${t.v}( ) takes one name`);
        take();
        if (low !== 'seen') throw new Error(`unknown function ${t.v}( ) – only seen( ) and exists( ) are known`);
        return { seen: normalName(arg.v), name: arg.v };
      }
      return { var: normalName(t.v), name: t.v };
    }
    throw new Error(`unexpected "${t.v}"`);
  };

  const e = or();
  if (i < tokens.length) throw new Error(`unexpected "${tokens[i].v}"`);
  return e;
}

export function evaluate(e, lookup, seen = () => false, exists = () => false) {
  const ev = (x) => evaluate(x, lookup, seen, exists);
  if ('num' in e) return e.num;
  if ('var' in e) return Number(lookup(e.var)) || 0;
  if ('seen' in e) return seen(e.seen) ? 1 : 0;
  if ('exists' in e) return exists(e.exists) ? 1 : 0;
  switch (e.op) {
    case 'or': return ev(e.a) || ev(e.b) ? 1 : 0;
    case 'and': return ev(e.a) && ev(e.b) ? 1 : 0;
    case 'not': return ev(e.a) ? 0 : 1;
    case 'neg': return -ev(e.a);
    case '>': return ev(e.a) > ev(e.b) ? 1 : 0;
    case '<': return ev(e.a) < ev(e.b) ? 1 : 0;
    case '>=': return ev(e.a) >= ev(e.b) ? 1 : 0;
    case '<=': return ev(e.a) <= ev(e.b) ? 1 : 0;
    case '==': return ev(e.a) === ev(e.b) ? 1 : 0;
    case '!=': return ev(e.a) !== ev(e.b) ? 1 : 0;
    case '+': return ev(e.a) + ev(e.b);
    case '-': return ev(e.a) - ev(e.b);
    case '*': return ev(e.a) * ev(e.b);
    case '/': { const d = ev(e.b); return d ? ev(e.a) / d : 0; }
  }
  return 0;
}

// The variable names a condition reads (to warn about unknown ones).
export function namesIn(e, out = []) {
  if (!e || 'num' in e || 'exists' in e) return out;
  if ('var' in e) out.push(e);
  if (e.a) namesIn(e.a, out);
  if (e.b) namesIn(e.b, out);
  return out;
}

// ---------- the file ----------

const BRANCH_HEAD = /^::\s*([^:]+?)\s*::$/;
const RULE = /^if\s+(.+?)\s+(?:trigger|->|then)\s+([^\s]+)\s*$/i;
const JUMP_IF = /^if\s+(.+?)\s*->\s*([^\s]+)\s*$/i;
const JUMP = /^->\s*([^\s]+)\s*$/;
const CHOICE = /^[>*]\s*(.+?)\s*->\s*([^\s]+)\s*$/;
const SET = /^set\s+([A-Za-z_][\w.\-]*)\s*=\s*(.+)$/i;
const CHRONICLE = /^chronicle\s*:\s*(.+)$/i;
const UNLOCK = /^(unlock|lock)\s+([^:]+)$/i;
const SCHEME = /^scheme\s+([^:]+)$/i;
const SAY = /^([^:]{1,40}?)\s*:\s+(.+)$/;
const PICK = /^pick\s+([A-Za-z_][\w.\-]*)\s*=\s*(.+)$/i;
const SEND = /^send\s+(.+?)\s*(?:->|\s+to\s+)\s*([^\s,]+)\s*$/i;
const BURN = /^burn\s+([^\s,]+)\s*$/i;
const IGNITE = /^ignite\s+([^\s,]+)\s*$/i;
const PUT_OUT = /^put\s+out\s+([^\s,]+)\s*$/i;

// A building named in the story: { no } (a house number) or { name } (one
// picked, normalName).
export function placeRef(text) {
  const t = String(text).trim();
  return /^\d+$/.test(t) ? { no: Number(t) } : { name: normalName(t) };
}

// What `pick` takes: a number, or [oldest | first | newest | last | random]
// <type or tag>, or nearest <type or tag> to <place>. `what` is normalName'd;
// 'building' (or 'buildings') is any of them.
function parseWhich(src) {
  const t = src.trim();
  if (/^\d+$/.test(t)) return { no: Number(t) };
  let m = /^nearest\s+(.+?)\s+(?:to|near)\s+(\S+)$/i.exec(t);
  if (m) return { how: 'nearest', what: normalName(m[1]), to: placeRef(m[2]), toText: m[2] };
  m = /^(?:(oldest|first|newest|last|random|any)\s+)?(.+)$/i.exec(t);
  const how = { first: 'oldest', last: 'newest', any: 'random' }[m[1]?.toLowerCase()] ?? m[1]?.toLowerCase() ?? 'random';
  if (/\s/.test(m[2].trim())) throw new Error(`can't tell what "${t}" is: say oldest house, newest pub, random farm, nearest hospoda to farm, or a number`);
  return { how, what: normalName(m[2]) };
}

export function parseStory(text) {
  const rules = [];
  const branches = new Map(); // normalName -> { name, line, steps }
  const errors = [];
  const fail = (line, msg) => errors.push({ line, msg });
  const cond = (src, line) => {
    try {
      return parseExpression(src);
    } catch (err) {
      fail(line, `in the condition "${src}": ${err.message}`);
      return null;
    }
  };

  const all = [];
  let branch = null;
  String(text).split(/\r?\n/).forEach((raw, k) => {
    const line = k + 1;
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) return;

    const head = BRANCH_HEAD.exec(t);
    if (head) {
      const key = normalName(head[1]);
      branch = { name: head[1], line, steps: [] };
      all.push(branch);
      // (a second one of the same name is still read, for its mistakes, but never told)
      if (branches.has(key)) fail(line, `there are two branches called ${head[1]} (the first is on line ${branches.get(key).line})`);
      else branches.set(key, branch);
      return;
    }
    if (t === '::') {
      branch = null;
      return;
    }

    if (!branch) {
      const rule = RULE.exec(t);
      if (!rule) return fail(line, `outside a branch only rules go ("if … trigger Branch"), not "${t}"`);
      const expr = cond(rule[1], line);
      if (expr) rules.push({ expr, branch: normalName(rule[2]), target: rule[2], line, src: rule[1] });
      return;
    }

    let m;
    if ((m = PICK.exec(t))) {
      try {
        branch.steps.push({ kind: 'pick', name: normalName(m[1]), which: parseWhich(m[2]), line });
      } catch (err) {
        fail(line, err.message);
      }
    } else if ((m = SEND.exec(t))) {
      const from = m[1].split(/\s*,\s*|\s+and\s+|\s+/i).filter(Boolean);
      branch.steps.push({ kind: 'send', from: from.map(placeRef), fromText: from, to: placeRef(m[2]), toText: m[2], line });
    } else if ((m = BURN.exec(t))) {
      branch.steps.push({ kind: 'burn', place: placeRef(m[1]), text: m[1], line });
    } else if ((m = IGNITE.exec(t))) {
      branch.steps.push({ kind: 'ignite', place: placeRef(m[1]), text: m[1], line });
    } else if ((m = PUT_OUT.exec(t))) {
      branch.steps.push({ kind: 'putOut', place: placeRef(m[1]), text: m[1], line });
    } else if ((m = JUMP_IF.exec(t))) {
      const expr = cond(m[1], line);
      if (expr) branch.steps.push({ kind: 'jump', expr, to: normalName(m[2]), target: m[2], line });
    } else if ((m = JUMP.exec(t))) {
      branch.steps.push({ kind: 'jump', to: normalName(m[1]), target: m[1], line });
    } else if ((m = CHOICE.exec(t))) {
      const last = branch.steps[branch.steps.length - 1];
      const option = { text: m[1], to: normalName(m[2]), target: m[2], line };
      if (last?.kind === 'choice') last.options.push(option);
      else branch.steps.push({ kind: 'choice', options: [option], line });
    } else if ((m = SET.exec(t))) {
      const expr = cond(m[2], line);
      if (expr) branch.steps.push({ kind: 'set', name: normalName(m[1]), expr, line });
    } else if ((m = SCHEME.exec(t))) {
      branch.steps.push({ kind: 'scheme', value: m[1].trim(), line });
    } else if ((m = UNLOCK.exec(t))) {
      branch.steps.push({ kind: 'unlock', unlock: m[1].toLowerCase() === 'unlock', name: m[2].trim(), line });
    } else if ((m = CHRONICLE.exec(t))) {
      branch.steps.push({ kind: 'chronicle', text: m[1], line });
    } else if ((m = SAY.exec(t)) && !/^(if|set)\b/i.test(t)) {
      branch.steps.push({ kind: 'say', speaker: m[1], text: m[2], line });
    } else {
      branch.steps.push({ kind: 'say', speaker: null, text: t, line });
    }
  });

  // every branch named must exist
  const check = (key, name, line) => {
    if (!branches.has(key)) fail(line, `there is no branch called ${name}`);
  };
  for (const r of rules) check(r.branch, r.target, r.line);
  // seen(Name) in any condition
  // the names picked, so exists( ), send and burn only name those
  const picked = new Set();
  for (const b of all) for (const st of b.steps) if (st.kind === 'pick') picked.add(st.name);
  const placeOk = (ref, text, line) => {
    if (ref.name && !picked.has(ref.name)) fail(line, `"${text}" is no house number and nothing picked (pick ${text} = …)`);
  };
  const seenIn = (e, line) => {
    if (!e || 'num' in e || 'var' in e) return;
    if ('exists' in e) return placeOk(e.exists, e.name, line);
    if ('seen' in e) return check(e.seen, e.name, line);
    seenIn(e.a, line);
    seenIn(e.b, line);
  };
  for (const r of rules) seenIn(r.expr, r.line);
  for (const b of all) for (const st of b.steps) seenIn(st.expr, st.line);
  for (const b of all) {
    for (const s of b.steps) {
      if (s.kind === 'jump') check(s.to, s.target, s.line);
      if (s.kind === 'send') { s.from.forEach((r, k) => placeOk(r, s.fromText[k], s.line)); placeOk(s.to, s.toText, s.line); }
      if (s.kind === 'burn' || s.kind === 'ignite' || s.kind === 'putOut') placeOk(s.place, s.text, s.line);
      if (s.kind === 'pick' && s.which.to) placeOk(s.which.to, s.which.toText, s.line);
      if (s.kind === 'choice') for (const o of s.options) check(o.to, o.target, o.line);
    }
  }
  return { rules, branches, errors, picked };
}

// {name} in a line: a variable's value (or the town's name for {town}).
export function fillIn(text, lookup, town) {
  return text.replace(/\{([^}]+)\}/g, (all, name) => {
    const key = normalName(name);
    if (key === 'town') return town;
    const v = lookup(key);
    return v === undefined ? all : String(Math.round(Number(v) * 100) / 100);
  });
}
