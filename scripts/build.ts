import { dirname, join } from 'path'
import { build } from 'esbuild'
import { rollup } from 'rollup'
import { lstatSync } from 'fs'

let t0 = Date.now()
let bundle = await rollup({
  input: ['src/ink.ts'],
  plugins: [{
    name: 'esbuild',
    async load(id) {
      const { outputFiles } = await build({
        entryPoints: [id],
        sourcemap: true,
        write: false,
        outdir: dirname(id),
        bundle: true,
        format: 'esm',
        target: 'esnext',
      })
      let code!: string, map!: string
      for (let file of outputFiles) {
        if (file.path.endsWith('.map')) {
          map = file.text
        } else {
          code = file.text
        }
      }
      return { code, map }
    }
  }]
})

let {output} = await bundle.write({
  dir: 'dist',
  format: 'esm',
  sourcemap: true,
  sourcemapExcludeSources: true,
})
let duration = Date.now() - t0

let numberFormat = new Intl.NumberFormat()
let formatInteger = (n: number) => numberFormat.format(n)

let bytesToText = (bytes: number): string => {
  if (bytes === 1) return '1 byte'
  if (bytes < 1024) return formatInteger(bytes) + ' bytes'
  if (bytes < 1024 * 1024) return formatInteger(bytes / 1024) + ' kb'
  if (bytes < 1024 * 1024 * 1024) return formatInteger(bytes / (1024 * 1024)) + ' mb'
  return formatInteger(bytes / (1024 * 1024 * 1024)) + ' gb'
}

let width1 = 0, width2 = 0, items: [string, string][] = []
for (let file of output) {
  let stat = lstatSync(join('dist', file.fileName))
  width1 = Math.max(width1, file.fileName.length)
  let sizeText = bytesToText(stat.size)
  width2 = Math.max(width2, sizeText.lastIndexOf(' '))
  items.push([file.fileName, sizeText])
}

console.log()
for (let [name, size] of items) {
  console.log('  dist/' + name.padEnd(width1) + '  ' + size.padStart(width2))
}
console.log()
console.log(`Done in ${duration}ms`)
