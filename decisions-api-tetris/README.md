# Decisions API Tetris

Tetris played by the proposed
[Decisions API](https://github.com/explainers-by-googlers/decisions-api)
(`DecisionModel`). Where the browser has no native implementation, the demo
loads the
[DecisionModel polyfill](../built-in-ai-task-apis-polyfills/README.md), which
runs either [Laya](https://github.com/johnhenry/laya-js) or
[open-jev](https://github.com/nico-martin/open-jev) in the browser. A switch in
the page picks the backend.

## How the model plays

For every new piece, the game lists each spot where the piece can come to rest
and describes it in one sentence, for example "The piece leaves no holes under
it and makes a small bump on top. It completes one line." Each distinct sentence
is the input to one `decide()` call with a single choice question:

```js
{
  id: 'look',
  type: 'choice',
  prompt: 'How does the stack look after the piece lands?',
  options: [
    { label: 'clean', description: 'flat with no holes' },
    { label: 'messy', description: 'holes or a tall tower' },
  ],
}
```

The piece goes to the spot with the highest probability of `clean`. The code
does the counting (holes, bumps, cleared lines) and hands the model the
conclusion in words. The phrasing follows the Tetris demo on
[brainfunctioncollapse.com/laya](https://brainfunctioncollapse.com/laya).

For comparison, the page can also play with a hand-tuned heuristic, or let you
play with the keyboard.

## Laya against open-jev

Ten games per backend, on the same ten piece sequences, capped at 300 pieces:

| Backend  | Survived 300 pieces | Average pieces | Average lines | Time per move |
| -------- | ------------------: | -------------: | ------------: | ------------: |
| Laya     |             7 of 10 |            269 |           102 |        ~0.5 s |
| open-jev |             0 of 10 |             72 |            13 |        ~0.9 s |

In 216 of its 717 moves, open-jev picked a spot that buries holes while a spot
without new holes was available. Laya never did. The sentences were tuned on
Laya, so open-jev may do better with a different phrasing.

## Running the demo

The models need WebGPU. Laya downloads about 0.8 GB and open-jev about 0.4 GB on
first use.

```bash
npm install
npm start
```

## Building

```bash
npm run build
```

The polyfill starts its worker from its own module URL, so the polyfill must not
share a chunk with code that touches `document`. See `vite.config.js`.
