# @hyrious/ink

Draw perfect pressure-sensitive freehand lines on the browser.

> This library implements a simplified algorithm of [perfect-freehand](https://github.com/steveruizok/perfect-freehand).

## Usage

```js
import { Stroke } from '@hyrious/ink'

// Create the stroke like in onpointerdown
let stroke = Stroke.create()

// Update the stroke like in onpointermove
stroke.push({ x: ev.clientX, y: ev.clientY, r: ev.pressure })

// The stroke is made up with many sections, get each section's outline
stroke.sections.forEach((index) => {
  // PERF: the outline() function is quite expensive,
  // only the last section might change by further 'push()'s
  let points = stroke.outline(index, 8)
  // Draw this stroke in any way you like
  let path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', points.reduce((d, { x, y }, i) => d + (i > 0 ? `L${x},${y}` : `M${x},${y}`), '') + 'z')
})

// Serialize the stroke
localStorage.setItem('stroke-0', JSON.stringify(stroke.toJSON()))

// De-serialize and restore a stroke
stroke = Stroke.fromJSON(JSON.parse(localStorage.getItem('stroke-0')))
```

### Possible CRDT Implementation

```ts
// Insert some points to stroke with `id`, at index `from`
type Message = { id: ID, from: number, points: { x: number, y: number, r: number }[] }

socket.on('stroke', (msg: Message) => {
  stroke = (strokes[msg.id] ||= Stroke.create())
  stroke.insert(msg.from, msg.points)
})
```

## License

MIT @ [hyrious](https://github.com/hyrious)
