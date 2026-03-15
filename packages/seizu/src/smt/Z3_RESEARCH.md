# Z3 Solver - Node.js Integration Research

## 1. z3-solver npm Package

### Overview

The official `z3-solver` npm package (v4.16.0) provides high-level and low-level TypeScript bindings for the Z3 theorem prover. Z3 itself is distributed as a WebAssembly artifact bundled within the package.

- **npm**: https://www.npmjs.com/package/z3-solver
- **Guide**: https://microsoft.github.io/z3guide/programming/Z3%20JavaScript%20Examples/
- **Repository**: https://github.com/Z3Prover/z3

### Installation

```bash
npm install z3-solver
```

### Requirements

- **SharedArrayBuffer** support is required (threads)
- Node.js >= 16 recommended
- For vitest/jest: may need `--experimental-vm-modules` or thread pool configuration

### Basic Usage (High-Level API)

```typescript
import { init } from 'z3-solver';

const { Context } = await init();
const { Solver, Int, And, Or, Not } = new Context('main');

const x = Int.const('x');
const y = Int.const('y');

const solver = new Solver();
solver.add(And(x.ge(0), x.le(100)));
solver.add(And(y.ge(0), y.le(100)));
solver.add(x.add(y).eq(150));

const result = await solver.check(); // 'sat' | 'unsat' | 'unknown'
if (result === 'sat') {
  const model = solver.model();
  console.log(`x = ${model.eval(x)}, y = ${model.eval(y)}`);
}
```

### Low-Level API (SMT-LIB String Execution)

The `z3-solver` package also exposes a low-level API via the emscripten module. However, the primary API is the high-level TypeScript API shown above. For SMT-LIB string execution, the approach is:

```typescript
import { init } from 'z3-solver';

const { Context } = await init();
const { Solver, Int } = new Context('main');

// The high-level API is preferred over raw SMT-LIB strings.
// For raw SMT-LIB, use the solver's fromString method if available,
// or use child_process with the z3 binary.
```

### Node vs Browser Import

```typescript
// Auto-detection (recommended)
import { init } from 'z3-solver';

// Explicit Node.js
import { init } from 'z3-solver/node';

// Explicit browser
import { init } from 'z3-solver/browser';
```

## 2. Alternative Approaches

### 2a. child_process with Z3 Binary

If `z3-solver` WASM proves problematic (SharedArrayBuffer issues, test runner incompatibility), we can shell out to the Z3 binary:

```typescript
import { execFile } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function solveSmtLib(smtlib: string): Promise<'sat' | 'unsat' | 'unknown'> {
  const tmpFile = join(tmpdir(), `seizu-smt-${Date.now()}.smt2`);
  await writeFile(tmpFile, smtlib, 'utf-8');

  return new Promise((resolve, reject) => {
    execFile('z3', [tmpFile], { timeout: 30_000 }, (error, stdout) => {
      unlink(tmpFile).catch(() => {});
      if (error) return reject(error);
      const output = stdout.trim();
      if (output.startsWith('sat')) resolve('sat');
      else if (output.startsWith('unsat')) resolve('unsat');
      else resolve('unknown');
    });
  });
}
```

**Pros**: No WASM complexity, direct SMT-LIB support, no SharedArrayBuffer requirement
**Cons**: Requires Z3 binary installed on system, process spawn overhead, not portable to browsers

### 2b. z3.wasm (Legacy)

The `z3.wasm` project by cpitclaudel provides a standalone WASM build with an SMT2 REPL-style API. However, this project is superseded by the official `z3-solver` package and is no longer maintained.

- Repository: https://github.com/cpitclaudel/z3.wasm

### 2c. z3-js-bindings

An alternative binding by bakkot providing both low-level C-like APIs and high-level Python-like APIs.

- Repository: https://github.com/bakkot/z3-js-bindings
- Status: WIP, not recommended for production

## 3. Recommendation for seizu v3

### Primary: `z3-solver` npm package (optional peer dependency)

- Use the high-level TypeScript API for constructing and solving SMT problems
- Translate our `SmtExpr` IR to Z3 high-level API calls instead of SMT-LIB strings
- Mark as optional peer dependency to avoid forcing installation on users who only need PBT

### Fallback: child_process with Z3 binary

- For CI environments where SharedArrayBuffer is unavailable
- For users who already have Z3 installed
- Direct SMT-LIB string support via our existing `buildSmtLib` encoder

### Architecture

```
SmtExpr IR (existing)
  |
  +-- encodeExpr() -> SMT-LIB string -> child_process z3 binary
  |
  +-- encodeToZ3Api() -> z3-solver high-level API calls (new)
```

Both backends produce the same `SmtResult` type. The solver selection is configurable, with auto-detection:

1. Try `z3-solver` npm package (if installed)
2. Fall back to `z3` binary on PATH
3. Return `UNKNOWN` with reason if neither available

## 4. Known Issues

- **SharedArrayBuffer**: Required by `z3-solver`. In Node.js this works out of the box, but test runners (vitest, jest) may need configuration.
- **Package size**: `z3-solver` bundles the full Z3 WASM (~30MB). This is acceptable as an optional dependency.
- **Initialization time**: `init()` is async and takes ~1-2 seconds. Should be cached/reused across verification runs.
- **Thread cleanup**: The emscripten module spawns worker threads. The `em` object returned by `init()` can be used to terminate them.

## Sources

- [z3-solver npm](https://www.npmjs.com/package/z3-solver)
- [Z3 JavaScript Guide](https://microsoft.github.io/z3guide/programming/Z3%20JavaScript%20Examples/)
- [Z3Prover/z3 GitHub](https://github.com/Z3Prover/z3)
- [z3.wasm](https://github.com/cpitclaudel/z3.wasm)
- [z3-js-bindings](https://github.com/bakkot/z3-js-bindings)
