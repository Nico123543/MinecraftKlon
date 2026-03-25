# MinecraftKlon (Web, TypeScript, Three.js)

Performanter Singleplayer-Voxel-Prototyp mit Chunk-Streaming, Worker-basierter Generierung/Meshing, Block-Interaktion und IndexedDB-Speicherung.

## Setup

```bash
npm install
npm run dev
```

## Build und Tests

```bash
npm test
npm run build
```

## Steuerung

- `Klick` auf Canvas: Pointer Lock
- `W A S D`: Bewegung
- `Space`: Springen
- `Maus links`: Block abbauen
- `Maus rechts`: Block setzen
- `1-0`: Blockauswahl in Hotbar (inkl. Wasser auf `0`)

## Architektur (kurz)

- Chunkgröße: `16 x 16 x 128`
- Welt: unendlich per Chunk-Streaming
- Blockspeicher: `Uint16Array`
- Worker: Terrain-Generierung + Greedy-Meshing
- Persistenz: IndexedDB, nur geänderte Chunks, RLE-komprimiert
- Performance-Overlay: FPS, 1%-Low, p95 Framezeit, Queue-Stats
