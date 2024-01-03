import * as fs from 'node:fs'
import * as path from 'node:path'
import * as cp from 'node:child_process'
import * as rollup from '@marijn/buildtool'
import pkg from './package.json' with { type: 'json' }
import replace from '@rollup/plugin-replace'

console.info('Building...')
fs.rmSync('dist', { recursive: true, force: true })

let commit = 'HEAD'
try { commit = cp.execFileSync('git', ['rev-parse', '--short=7', commit], { encoding: 'utf8' }).trimEnd() }
catch {}

let t0 = Date.now()
await rollup.build(path.resolve('src/ink.ts'), {
  pureTopCalls: true,
  bundleName: pkg.name.split('/').pop(),
  outputPlugin: () => replace({
    values: {
      '__DEV__': "!!(process.env.NODE_ENV !== 'production')",
      '__COMMIT__': `'${commit}'`,
      '__VERSION__': `'${pkg.version}'`,
    },
    preventAssignment: true
  })
})
console.info(`Done in ${((Date.now() - t0) / 1000).toFixed(2)}s`)
