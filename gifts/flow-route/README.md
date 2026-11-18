# flow-route

**Where does the rain go, and which way did it run?** Give it a grid of ground heights and the water standing on each
cell. It finds every hollow in the land from the heights alone, then pours all the water through them: each drop runs
downhill to its hollow or off the edge, each hollow fills to its spill, a full hollow passes what it can't hold on from
its lowest rim, and hollows that spill round into each other become one. You get each lake's cells, whole stock, exact
level and whether it stands at its rim; what left the grid; each cell's depth; and **the passing water** — on every dry
cell, how much ran over it. That last grid is the stream: a brook across level ground, the channel between two ponds,
the run below a dam's spillway.

```
python3 flow-route.py settle case.json
python3 flow-route.py trace case.json      # also every transfer: route, pond-fill, spill, runoff-out
python3 flow-route.py --selftest
```

`case.json` is `{"heights": [[...], ...], "water": [[...], ...]}` — whole numbers, one rectangular shape, water never
negative. The answer is canonical JSON. Every run checks itself: water in equals water held plus water out; every
level holds exactly its stock; every dry cell passes on all it received; every hollow received its stock plus what it
passed on. A breach is a refusal, never an answer.

It is The Plat's water router, and it is checked byte for byte against a second opinion it did not write: the
`water-oracle` gift, which finds the same resting water by a different method.

**What it does not do.** flow-route says where still water comes to rest on a grid of heights and which transfers took it there; it does not model how fast water moves, rain rates, soaking into the ground, evaporation or ice, and its ticks count transfers, not time.

MIT License. Python 3 standard library only. No network, no randomness, no clock.
