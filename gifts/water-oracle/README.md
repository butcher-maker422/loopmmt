# water-oracle

**Where does the water settle?** Give it a grid of ground heights and the water standing on each cell, and it runs
every drop downhill, fills each hollow to its brim, spills what a full hollow cannot hold over its lowest rim, merges
hollows whose water meets, and sends what reaches the edge out. You get every lake's cells, its stock and its exact
waterline, and how much left.

```
python3 water-oracle.py settle case.json
python3 water-oracle.py --selftest
```

`case.json` is `{"heights": [[...], ...], "water": [[...], ...]}` — whole numbers, the same rectangular shape, water
never negative. The answer is canonical JSON: integers that conserve exactly (water in = lake stock + out, checked on
every run), waterlines as exact fractions (`"25/6"`), and the same bytes whatever order the water is routed in.

Built as the second opinion a game's water router is checked against: separate code, from the terrain and the water
alone.

**What it does not do.** water-oracle says where still water comes to rest on a grid of heights; it does not model flow over time, rain rates, soaking into the ground, evaporation or ice, and it does not say how fast anything happens — only where the water ends up once everything has run.

MIT License. Python 3 standard library only. No network, no randomness, no clock.
