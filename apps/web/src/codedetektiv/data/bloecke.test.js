// Der Blockbaum und vor allem die Lösungsprüfung.
//
// `compareBlocks` entscheidet, ob ein Kind richtig liegt — und war bis zum
// Zusammenlegen der beiden Kopien ungeprüft. Die Fälle hier sind genau die,
// bei denen ein Nachbau auseinanderläuft: Felder mit `check: false`, leere
// gegen gefüllte Steckplätze, verschachtelte Container.
//
// Die Beschriftungen ('gehe vorwärts' …) sind DATEN und werden zeichengleich
// verglichen. Wer sie übersetzt, bricht die Prüfung — dieser Test hält das fest.
import { describe, expect, it } from "vitest";

import {
  addToContainer, canAppendToStack, compareBlocks, countAllBlocks, fillSlot,
  findBlock, findParentContainer, findStackByBlockId, flattenSolution,
  getSubStack, insertAt, isContainerType, isHatType, moveBlock, partsSig,
  removeBlockDeep, removeSubStack, slotSig, updateBlockField, valueSig,
} from "./bloecke.js";

const blk = (id, extra = {}) => ({ id, type: "statement", cat: "basic", label: id, ...extra });
const cont = (id, children, extra = {}) => ({ id, type: "container", cat: "loops", label: id, children, ...extra });

describe("Blocktypen", () => {
  it("kennt Container und Hüte", () => {
    expect(isContainerType("container")).toBe(true);
    expect(isContainerType("event-container")).toBe(true);
    expect(isContainerType("statement")).toBe(false);
    expect(isHatType("event")).toBe(true);
    expect(isHatType("event-container")).toBe(true);
    expect(isHatType("container")).toBe(false);
  });
});

describe("Baum", () => {
  const baum = [blk("a"), cont("c", [blk("x"), blk("y")]), blk("b")];

  it("findet auch tief", () => {
    expect(findBlock(baum, "y").id).toBe("y");
    expect(findBlock(baum, "weg")).toBe(null);
  });

  it("unterscheidet oberste Ebene (null) von gibt-es-nicht (undefined)", () => {
    expect(findParentContainer(baum, "a")).toBe(null);
    expect(findParentContainer(baum, "x").id).toBe("c");
    expect(findParentContainer(baum, "weg")).toBe(undefined);
  });

  it("zählt Kinder mit", () => {
    expect(countAllBlocks(baum)).toBe(5);
    expect(countAllBlocks([])).toBe(0);
  });

  it("ändert ein Feld, ohne den Rest anzufassen", () => {
    const mit = [blk("a", { fields: [{ key: "ms", value: "500" }, { key: "n", value: "1" }] })];
    const neu = updateBlockField(mit, "a", "ms", "800");
    expect(neu[0].fields).toEqual([{ key: "ms", value: "800" }, { key: "n", value: "1" }]);
    expect(mit[0].fields[0].value).toBe("500");   // Original bleibt
  });

  it("ändert ein Feld auch in einem Container", () => {
    const mit = [cont("c", [blk("x", { fields: [{ key: "n", value: "1" }] })])];
    expect(updateBlockField(mit, "x", "n", "7")[0].children[0].fields[0].value).toBe("7");
  });

  it("hängt in einen Container und nimmt wieder heraus", () => {
    const mit = addToContainer(baum, "c", blk("z"));
    expect(mit[1].children.map(b => b.id)).toEqual(["x", "y", "z"]);
    expect(removeBlockDeep(mit, "z")[1].children.map(b => b.id)).toEqual(["x", "y"]);
    expect(removeBlockDeep(mit, "c").map(b => b.id)).toEqual(["a", "b"]);
  });

  it("fügt an einer Stelle ein", () => {
    expect(insertAt([blk("a"), blk("b")], null, 1, blk("m")).map(b => b.id)).toEqual(["a", "m", "b"]);
    expect(insertAt(baum, "c", 1, blk("m"))[1].children.map(b => b.id)).toEqual(["x", "m", "y"]);
  });
});

describe("moveBlock", () => {
  it("verschiebt nach hinten und rechnet die Entnahme heraus", () => {
    const liste = [blk("a"), blk("b"), blk("c")];
    expect(moveBlock(liste, "a", { parentId: null, index: 2 }).map(b => b.id)).toEqual(["b", "a", "c"]);
  });

  it("verschiebt nach vorn", () => {
    const liste = [blk("a"), blk("b"), blk("c")];
    expect(moveBlock(liste, "c", { parentId: null, index: 0 }).map(b => b.id)).toEqual(["c", "a", "b"]);
  });

  it("schiebt in einen Container", () => {
    const liste = [blk("a"), cont("c", [])];
    const neu = moveBlock(liste, "a", { parentId: "c", index: 0 });
    expect(neu.map(b => b.id)).toEqual(["c"]);
    expect(neu[0].children.map(b => b.id)).toEqual(["a"]);
  });

  it("lässt einen Container nicht in sich selbst wandern", () => {
    const liste = [cont("c", [cont("d", [])])];
    expect(moveBlock(liste, "c", { parentId: "d", index: 0 })).toBe(liste);
  });
});

describe("Steckplätze", () => {
  const wert = { type: "value", cat: "math", parts: [{ text: "42" }] };

  it("füllt und leert", () => {
    const mit = [blk("a", { slots: [{ id: "s1", child: null }] })];
    const voll = fillSlot(mit, "s1", wert);
    expect(voll[0].slots[0].child).toEqual(wert);
    expect(fillSlot(voll, "s1", null)[0].slots[0].child).toBe(null);
  });

  it("beschreibt einen Steckplatz eindeutig", () => {
    expect(slotSig(null)).toBe("");
    expect(slotSig({ id: "s" })).toBe("_");
    expect(slotSig({ id: "s", literal: { value: "3" } })).toBe("l:3");
    expect(slotSig({ id: "s", child: wert })).toBe("c(math:t:42)");
  });

  it("beschreibt Bausteinteile", () => {
    expect(partsSig([{ text: "wenn" }, { id: "s", child: wert }])).toBe("t:wenn|s:c(math:t:42)");
    expect(valueSig(null)).toBe("∅");
  });
});

describe("compareBlocks — liegt das Kind richtig?", () => {
  const loesung = [
    blk("s1", { label: "beim Start", cat: "basic", type: "event" }),
    cont("s2", [blk("s3", { label: "zeige Zahl", fields: [{ key: "num", value: "1" }] })],
      { label: "wiederhole", fields: [{ key: "count", value: "3" }] }),
  ];
  // Die Abgabe hat eigene ids — verglichen wird nie über die id.
  const richtig = () => [
    blk("p1", { label: "beim Start", cat: "basic", type: "event" }),
    cont("p2", [blk("p3", { label: "zeige Zahl", fields: [{ key: "num", value: "1" }] })],
      { label: "wiederhole", fields: [{ key: "count", value: "3" }] }),
  ];

  it("nimmt die richtige Lösung an", () => {
    expect(compareBlocks(richtig(), loesung)).toBe(true);
  });

  it("merkt zu wenige und zu viele Blöcke", () => {
    expect(compareBlocks(richtig().slice(0, 1), loesung)).toBe(false);
    expect(compareBlocks([...richtig(), blk("p4")], loesung)).toBe(false);
  });

  it("merkt eine andere Beschriftung — auch eine übersetzte", () => {
    const p = richtig(); p[0].label = "on start";
    expect(compareBlocks(p, loesung)).toBe(false);
  });

  it("merkt eine andere Kategorie bei gleicher Beschriftung", () => {
    const p = richtig(); p[0].cat = "led";
    expect(compareBlocks(p, loesung)).toBe(false);
  });

  it("merkt einen falschen Feldwert", () => {
    const p = richtig(); p[1].fields[0].value = "4";
    expect(compareBlocks(p, loesung)).toBe(false);
  });

  it("merkt ein fehlendes Feld", () => {
    const p = richtig(); p[1].fields = [];
    expect(compareBlocks(p, loesung)).toBe(false);
  });

  it("lässt Felder mit check:false in Ruhe (die Pausendauer ist egal)", () => {
    const l = [blk("s", { label: "pausiere", fields: [{ key: "ms", value: "500", check: false }] })];
    const p = [blk("p", { label: "pausiere", fields: [{ key: "ms", value: "999" }] })];
    expect(compareBlocks(p, l)).toBe(true);
  });

  it("vergleicht den Rumpf eines Containers mit", () => {
    const p = richtig(); p[1].children[0].label = "zeige Text";
    expect(compareBlocks(p, loesung)).toBe(false);
    const leer = richtig(); leer[1].children = [];
    expect(compareBlocks(leer, loesung)).toBe(false);
  });

  it("verlangt einen Rumpf, wo die Lösung einen hat", () => {
    const p = richtig(); delete p[1].children;
    expect(compareBlocks(p, loesung)).toBe(false);
  });

  it("vergleicht Steckplätze", () => {
    const wert = { type: "value", cat: "math", parts: [{ text: "42" }] };
    const mit = (slots) => [{ id: "x", type: "statement", cat: "math", label: "setze auf", slots }];
    const l = mit([{ id: "a", child: wert }]);
    expect(compareBlocks(mit([{ id: "b", child: { ...wert } }]), l)).toBe(true);
    expect(compareBlocks(mit([{ id: "b", child: null }]), l)).toBe(false);
    expect(compareBlocks(mit([]), l)).toBe(false);
    expect(compareBlocks([{ id: "x", type: "statement", cat: "math", label: "setze auf" }], l)).toBe(false);
  });

  it("vergleicht Bausteinteile", () => {
    const l = [{ id: "s", cat: "logic", parts: [{ text: "wenn" }, { id: "x" }] }];
    expect(compareBlocks([{ id: "p", cat: "logic", parts: [{ text: "wenn" }, { id: "y" }] }], l)).toBe(true);
    expect(compareBlocks([{ id: "p", cat: "logic", parts: [{ text: "solange" }, { id: "y" }] }], l)).toBe(false);
  });
});

describe("Werkzeugkiste aus der Lösung", () => {
  it("legt Container und ihre Kinder einzeln hinein", () => {
    const l = [cont("c", [blk("x"), blk("y")]), blk("a")];
    const flach = flattenSolution(l);
    expect(flach.map(b => b.id)).toEqual(["c", "x", "y", "a"]);
    expect(flach[0].children).toEqual([]);          // der Rumpf muss leer sein
    expect(l[0].children).toHaveLength(2);          // Original bleibt
  });
});

describe("Stapel", () => {
  const stapel = { id: "s", blocks: [blk("a"), blk("b"), blk("c")] };

  it("nimmt beim Ziehen alles mit, was unten dranhängt", () => {
    expect(getSubStack(stapel, "b").map(b => b.id)).toEqual(["b", "c"]);
    expect(getSubStack(stapel, "weg")).toEqual([]);
    expect(removeSubStack(stapel.blocks, "b").map(b => b.id)).toEqual(["a"]);
    expect(removeSubStack(stapel.blocks, "weg")).toBe(stapel.blocks);
  });

  it("lässt einen Hut nur auf einen leeren Stapel", () => {
    const hut = [blk("h", { type: "event" })];
    expect(canAppendToStack(stapel, hut)).toBe(false);
    expect(canAppendToStack({ id: "leer", blocks: [] }, hut)).toBe(true);
    expect(canAppendToStack(stapel, [blk("n")])).toBe(true);
    expect(canAppendToStack(stapel, [])).toBe(false);
  });

  it("findet den Stapel zu einem Block — auch zu einem Kind", () => {
    const stacks = [stapel, { id: "t", blocks: [cont("k", [blk("x")])] }];
    expect(findStackByBlockId(stacks, "k").id).toBe("t");
    expect(findStackByBlockId(stacks, "x").id).toBe("t");
    expect(findStackByBlockId(stacks, "weg")).toBe(undefined);
  });
});
